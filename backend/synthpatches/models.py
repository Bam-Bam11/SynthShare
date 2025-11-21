from django.db import models, transaction
from django.contrib.auth.models import User
from django.db.models import F
from .utils import to_base32


class SoftDeleteManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)
    
    def with_deleted(self):
        return super().get_queryset()
    
    def deleted_only(self):
        return super().get_queryset().filter(is_deleted=True)


class Patch(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, default='')
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='patches')
    parameters = models.JSONField()
    synth_type = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    downloads = models.PositiveIntegerField(default=0)
    forks = models.PositiveIntegerField(default=0)

    # lineage
    root = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='descendants')
    stem = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='forks_from')
    immediate_predecessor = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='direct_successors')

    # "<fork>.<edit>" in base-32 (digits 0-9, a-v)
    version = models.CharField(max_length=20, blank=True, default='0.0')

    duration = models.CharField(max_length=10, default='8n')
    is_posted = models.BooleanField(default=False)
    
    # Soft delete
    is_deleted = models.BooleanField(default=False)

    objects = SoftDeleteManager()

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} (v{self.version})'

    # --------------------------
    # Explicit constructors
    # --------------------------
    @classmethod
    @transaction.atomic
    def create_root(cls, *, name, uploaded_by, parameters, synth_type, **extra):
        inst = cls(
            name=name,
            uploaded_by=uploaded_by,
            parameters=parameters,
            synth_type=synth_type,
            **extra
        )
        inst.save()
        return inst

    @classmethod
    @transaction.atomic
    def fork_from(cls, source: 'Patch', *, name, uploaded_by, parameters, synth_type, **extra):
        root = source.root or source
        inst = cls(
            name=name,
            uploaded_by=uploaded_by,
            parameters=parameters,
            synth_type=synth_type,
            root=root,
            stem=source,                   # we fork FROM this node
            immediate_predecessor=source,  # exact parent
            **extra
        )
        # allow same-user forks by forcing fork path in save()
        inst._force_fork = True
        inst.save()
        return inst

    @classmethod
    @transaction.atomic
    def edit_from(cls, source: 'Patch', *, name, uploaded_by, parameters, synth_type, **extra):
        root = source.root or source
        inst = cls(
            name=name,
            uploaded_by=uploaded_by,
            parameters=parameters,
            synth_type=synth_type,
            root=root,
            stem=source,                   # the exact node we edited
            immediate_predecessor=source,  # one-step link
            **extra
        )
        inst.save()
        return inst

    # --------------------------
    # Core lineage/versioning
    # --------------------------
    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)

        if not is_new:
            return

        # Root creation (no root supplied)
        if not self.root:
            self.root = self
            self.stem = self
            self.immediate_predecessor = None
            self.version = '0.0'
            super().save(update_fields=['root', 'stem', 'immediate_predecessor', 'version'])
            return

        # Defensive default if client forgot stem
        if not self.stem:
            self.stem = self.root

        # Edit vs fork decision
        if self.uploaded_by_id == self.stem.uploaded_by_id and not getattr(self, "_force_fork", False):
            self._finalise_edit()
        else:
            self._finalise_fork()

    @transaction.atomic
    def _finalise_fork(self):
        source_node = self.stem  # capture before we repoint stem
        next_fork_index = self._next_fork_index_for_root(self.root)
        self.version = f'{to_base32(next_fork_index)}.0'
        self.immediate_predecessor = source_node
        self.stem_id = self.pk  # fork head anchors its lineage
        super().save(update_fields=['version', 'immediate_predecessor', 'stem'])

        # increment predecessor's forks counter (even if deleted)
        if source_node_id := getattr(source_node, 'pk', None):
            Patch.objects.with_deleted().filter(pk=source_node_id).update(forks=F('forks') + 1)

    @transaction.atomic
    def _finalise_edit(self):
        source_node = self.stem  # the exact node we edited
        fork_str = (source_node.version or '0.0').split('.', 1)[0]

        # find fork head x.0 (root if x == '0'), with safe fallbacks to avoid 500s on legacy data
        fork_head = self._safe_fork_head_lookup(self.root, source_node, fork_str)

        # stem should point to the fork head; predecessor is the exact parent node
        self.stem = fork_head
        if not self.immediate_predecessor_id:
            self.immediate_predecessor = source_node

        # --- FIX: compute next edit index as max(existing edit idx) + 1 (per user, per fork) ---
        next_e = self._next_edit_index_user(self.root, fork_str, self.uploaded_by_id)

        self.version = f'{fork_str}.{to_base32(next_e)}'
        super().save(update_fields=['stem', 'immediate_predecessor', 'version'])

    # --------------------------
    # Helpers
    # --------------------------
    @staticmethod
    def _parse_version(ver: str):
        try:
            f_str, e_str = (ver or '0.0').split('.', 1)
            return int(f_str, 32), int(e_str, 32)
        except Exception:
            return 0, 0

    @classmethod
    @transaction.atomic
    def _next_edit_index_user(cls, root: 'Patch', fork_str: str, user_id: int) -> int:
        """
        Return next edit index (per user, per fork) under a root, as max(existing e) + 1.
        Ensures first edit after 'x.0' is 'x.1' (no off-by-one).
        """
        prefix = f'{fork_str}.'
        versions = list(
            cls.objects.select_for_update()
            .filter(root=root, uploaded_by_id=user_id, version__startswith=prefix)
            .values_list('version', flat=True)
        )
        max_e = 0
        for v in versions:
            _, e = cls._parse_version(v)
            if e > max_e:
                max_e = e
        return max_e + 1

    @classmethod
    def _safe_fork_head_lookup(cls, root: 'Patch', source_node: 'Patch', fork_str: str) -> 'Patch':
        """
        Returns the fork head (x.0) for a given fork index string.
        Falls back gracefully if a clean head cannot be found (legacy/inconsistent data):
          1) if fork_str == '0' -> root
          2) try exact 'x.0'
          3) any earliest node in that fork lineage (version startswith 'x.')
          4) source_node itself if it matches fork_str
          5) root (least-bad fallback)
        """
        if fork_str == '0':
            return root

        head = cls.objects.with_deleted().filter(root=root, version=f'{fork_str}.0').first()
        if head:
            return head

        # fallback: earliest node in this fork lineage
        head = cls.objects.with_deleted().filter(root=root, version__startswith=f'{fork_str}.').order_by('created_at').first()
        if head:
            return head

        # fallback: use source_node if it is in this fork
        if (source_node.version or '0.0').split('.', 1)[0] == fork_str:
            return source_node

        # last resort
        return root

    @classmethod
    @transaction.atomic
    def _next_fork_index_for_root(cls, root: 'Patch') -> int:
        """
        Compute the next global fork index under the given root.
        We look only at fork heads (edit index == '0') and decode base-32 with int(..., 32).
        """
        versions = list(
            cls.objects.with_deleted().select_for_update().filter(root=root).values_list('version', flat=True)
        )
        fork_indices = []
        for v in versions:
            try:
                f_str, e_str = v.split('.', 1)
                if e_str == '0':
                    fork_indices.append(int(f_str, 32))
            except Exception:
                continue
        return (max(fork_indices) + 1) if fork_indices else 1  # after 0.0, first fork is 1.0


class Follow(models.Model):
    follower = models.ForeignKey(User, related_name='following', on_delete=models.CASCADE)
    following = models.ForeignKey(User, related_name='followers', on_delete=models.CASCADE)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('follower', 'following')  # prevent duplicates

    def __str__(self):
        return f"{self.follower.username} follows {self.following.username}"


# --------------------------
# Track implementation
# --------------------------

class Track(models.Model):
    name = models.CharField(max_length=120)
    # Free-form user text (no more timeline data here)
    description = models.TextField(blank=True, default='')

    # NEW: canonical timeline stored here
    composition = models.JSONField(default=dict, blank=True)

    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tracks')
    bpm = models.PositiveIntegerField(default=120)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    downloads = models.PositiveIntegerField(default=0)
    forks = models.PositiveIntegerField(default=0)

    root = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='track_descendants')
    stem = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='track_forks_from')
    immediate_predecessor = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='track_direct_successors')

    version = models.CharField(max_length=20, blank=True, default='0.0')
    is_posted = models.BooleanField(default=False)
    
    # Soft delete
    is_deleted = models.BooleanField(default=False)

    objects = SoftDeleteManager()

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} (v{self.version})'

    @classmethod
    @transaction.atomic
    def create_root(cls, *, name, uploaded_by, bpm=120, description='', composition=None, **extra):
        inst = cls(
            name=name,
            uploaded_by=uploaded_by,
            bpm=bpm,
            description=description,
            composition=composition or {"version": 1, "items": []},
            **extra,
        )
        inst.save()
        return inst

    @classmethod
    @transaction.atomic
    def fork_from(cls, source: 'Track', *, name, uploaded_by, **extra):
        root = source.root or source
        inst = cls(
            name=name,
            uploaded_by=uploaded_by,
            root=root,
            stem=source,
            immediate_predecessor=source,
            **extra,
        )
        inst._force_fork = True
        inst.save()
        return inst

    @classmethod
    @transaction.atomic
    def edit_from(cls, source: 'Track', *, name, uploaded_by, **extra):
        root = source.root or source
        inst = cls(
            name=name,
            uploaded_by=uploaded_by,
            root=root,
            stem=source,
            immediate_predecessor=source,
            **extra,
        )
        inst.save()
        return inst



    # --------------------------
    # Core lineage/versioning (mirror Patch.save)
    # --------------------------
    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)

        if not is_new:
            return

        # Root creation (no root supplied)
        if not self.root:
            self.root = self
            self.stem = self
            self.immediate_predecessor = None
            self.version = '0.0'
            super().save(update_fields=['root', 'stem', 'immediate_predecessor', 'version'])
            return

        # Defensive default if client forgot stem
        if not self.stem:
            self.stem = self.root

        # Edit vs fork decision
        if self.uploaded_by_id == self.stem.uploaded_by_id and not getattr(self, "_force_fork", False):
            self._finalise_edit()
        else:
            self._finalise_fork()

    @transaction.atomic
    def _finalise_fork(self):
        source_node = self.stem  # capture before we repoint stem
        next_fork_index = self._next_fork_index_for_root(self.root)
        self.version = f'{to_base32(next_fork_index)}.0'
        self.immediate_predecessor = source_node
        self.stem_id = self.pk  # fork head anchors its lineage
        super().save(update_fields=['version', 'immediate_predecessor', 'stem'])

        # increment predecessor's forks counter (even if deleted)
        if source_node_id := getattr(source_node, 'pk', None):
            Track.objects.with_deleted().filter(pk=source_node_id).update(forks=F('forks') + 1)

    @transaction.atomic
    def _finalise_edit(self):
        source_node = self.stem  # the exact node we edited
        fork_str = (source_node.version or '0.0').split('.', 1)[0]

        # find fork head x.0 (root if x == '0'), with safe fallbacks to avoid 500s on legacy data
        fork_head = self._safe_fork_head_lookup(self.root, source_node, fork_str)

        # stem should point to the fork head; predecessor is the exact parent node
        self.stem = fork_head
        if not self.immediate_predecessor_id:
            self.immediate_predecessor = source_node

        # next edit index = max(existing e) + 1 (per user, per fork), same as Patch
        next_e = self._next_edit_index_user(self.root, fork_str, self.uploaded_by_id)

        self.version = f'{fork_str}.{to_base32(next_e)}'
        super().save(update_fields=['stem', 'immediate_predecessor', 'version'])

    # --------------------------
    # Helpers (mirror Patch)
    # --------------------------
    @staticmethod
    def _parse_version(ver: str):
        try:
            f_str, e_str = (ver or '0.0').split('.', 1)
            return int(f_str, 32), int(e_str, 32)
        except Exception:
            return 0, 0

    @classmethod
    @transaction.atomic
    def _next_edit_index_user(cls, root: 'Track', fork_str: str, user_id: int) -> int:
        """
        Return next edit index (per user, per fork) under a root, as max(existing e) + 1.
        Ensures first edit after 'x.0' is 'x.1'.
        """
        prefix = f'{fork_str}.'
        versions = list(
            cls.objects.select_for_update()
            .filter(root=root, uploaded_by_id=user_id, version__startswith=prefix)
            .values_list('version', flat=True)
        )
        max_e = 0
        for v in versions:
            _, e = cls._parse_version(v)
            if e > max_e:
                max_e = e
        return max_e + 1

    @classmethod
    def _safe_fork_head_lookup(cls, root: 'Track', source_node: 'Track', fork_str: str) -> 'Track':
        """
        Returns the fork head (x.0) for a given fork index string.
        Fallbacks:
          1) if fork_str == '0' -> root
          2) exact 'x.0'
          3) earliest node in that fork lineage (version startswith 'x.')
          4) source_node itself if it matches fork_str
          5) root (last resort)
        """
        if fork_str == '0':
            return root

        head = cls.objects.with_deleted().filter(root=root, version=f'{fork_str}.0').first()
        if head:
            return head

        head = cls.objects.with_deleted().filter(root=root, version__startswith=f'{fork_str}.').order_by('created_at').first()
        if head:
            return head

        if (source_node.version or '0.0').split('.', 1)[0] == fork_str:
            return source_node

        return root

    @classmethod
    @transaction.atomic
    def _next_fork_index_for_root(cls, root: 'Track') -> int:
        """
        Compute the next global fork index under the given root.
        We look only at fork heads (edit index == '0') and decode base-32 with int(..., 32).
        """
        versions = list(
            cls.objects.with_deleted().select_for_update().filter(root=root).values_list('version', flat=True)
        )
        fork_indices = []
        for v in versions:
            try:
                f_str, e_str = v.split('.', 1)
                if e_str == '0':
                    fork_indices.append(int(f_str, 32))
            except Exception:
                continue
        return (max(fork_indices) + 1) if fork_indices else 1  # after 0.0, first fork is 1.0