from django.db import models
from django.contrib.auth.models import User
from .utils import to_base32

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
    root = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='descendants')
    stem = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='forks_from')
    immediate_predecessor = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='direct_successors')
    version = models.CharField(max_length=20, blank=True, default='0.0')
    note = models.CharField(max_length=10, default='C4')
    duration = models.CharField(max_length=10, default='8n')
    is_posted = models.BooleanField(default=False)

    def save(self, *args, **kwargs):
        is_new = self.pk is None
        print(f"[DEBUG] Patch save triggered: name={self.name}, is_new={is_new}, uploaded_by_id={self.uploaded_by_id}")

        if is_new:
            super().save(*args, **kwargs)  # Save first to get PK
            self._assign_version_and_lineage()
            super().save(update_fields=['root', 'version', 'immediate_predecessor'])
        else:
            super().save(*args, **kwargs)

    def _assign_version_and_lineage(self):
        if not self.root:
            self.root = self
            self.version = '0.0'
            self.immediate_predecessor = None
            return

        # Always track immediate predecessor
        if not self.immediate_predecessor:
            self.immediate_predecessor = self.stem

        # Editing: same user continuing a stem
        if self.stem and self.uploaded_by_id == self.stem.uploaded_by_id:
            fork_str = self.stem.version.split('.')[0]

            # Extract the fork index string from stem.version
            fork_str = self.stem.version.split('.')[0]

            # Count all patches by this user under this root with that same fork index
            edit_index = Patch.objects.filter(
                root=self.root,
                uploaded_by_id=self.uploaded_by_id,
                version__startswith=f'{fork_str}.'
            ).count()


            self.version = f'{fork_str}.{to_base32(edit_index)}'

        else:
            # Forking — increment fork counter and assign new index
            if self.stem:
                self.stem.forks += 1
                self.stem.save(update_fields=['forks'])

            fork_index = self._get_next_fork_index()
            self.version = f'{to_base32(fork_index)}.0'

    def _get_next_fork_index(self):
        versions = Patch.objects.filter(root=self.root).values_list('version', flat=True)
        fork_indices = []

        for version in versions:
            try:
                fork_str, edit_str = version.split('.')
                if edit_str == '0':
                    fork_indices.append(int(fork_str, 32))
            except Exception:
                continue

        return max(fork_indices, default=0) + 1


    def __str__(self):
        return f'{self.name} (v{self.version})'

    class Meta:
        ordering = ['-created_at']

class Follow(models.Model):
    follower = models.ForeignKey(User, related_name='following', on_delete=models.CASCADE)
    following = models.ForeignKey(User, related_name='followers', on_delete=models.CASCADE)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('follower', 'following')  # prevent duplicates

    def __str__(self):
        return f"{self.follower.username} follows {self.following.username}"
    

#Track implementation

class Track(models.Model):
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default='')
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tracks')
    bpm = models.PositiveIntegerField(default=120)
    time_signature = models.CharField(max_length=8, default='4/4')  # optional MVP
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    downloads = models.PositiveIntegerField(default=0)
    forks = models.PositiveIntegerField(default=0)
    # versioning lineage (mirror Patch)
    root = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='track_descendants')
    stem = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='track_forks_from')
    immediate_predecessor = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='track_direct_successors')
    version = models.CharField(max_length=20, blank=True, default='0.0')
    is_posted = models.BooleanField(default=False)

    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)
        if is_new:
            self._assign_version_and_lineage()
            super().save(update_fields=['root', 'version', 'immediate_predecessor'])

    def _assign_version_and_lineage(self):
        if not self.root:
            self.root = self
            self.version = '0.0'
            self.immediate_predecessor = None
            return

        if not self.immediate_predecessor:
            self.immediate_predecessor = self.stem

        # edit vs fork logic mirrors Patch
        if self.stem and self.uploaded_by_id == self.stem.uploaded_by_id:
            fork_str = self.stem.version.split('.')[0]
            edit_index = Track.objects.filter(
                root=self.root,
                uploaded_by_id=self.uploaded_by_id,
                version__startswith=f'{fork_str}.'
            ).count()
            self.version = f'{fork_str}.{to_base32(edit_index)}'
        else:
            if self.stem:
                self.stem.forks += 1
                self.stem.save(update_fields=['forks'])
            fork_index = self._get_next_fork_index()
            self.version = f'{to_base32(fork_index)}.0'

    def _get_next_fork_index(self):
        versions = Track.objects.filter(root=self.root).values_list('version', flat=True)
        fork_indices = []
        for version in versions:
            try:
                fork_str, edit_str = version.split('.')
                if edit_str == '0':
                    fork_indices.append(int(fork_str, 32))
            except Exception:
                continue
        return max(fork_indices, default=0) + 1

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} (v{self.version})'


class TrackItem(models.Model):
    """
    One channel/part in the track. MVP matches 16-step boolean pattern
    and a single note/duration per hit (uses the patch's defaults).
    """
    track = models.ForeignKey(Track, on_delete=models.CASCADE, related_name='items')
    order_index = models.PositiveIntegerField(default=0)   # vertical order in UI
    patch = models.ForeignKey('Patch', on_delete=models.PROTECT)  # reference for lineage/credits
    patch_snapshot = models.JSONField()  # frozen params for reproducibility
    steps = models.JSONField(default=list)  # e.g. [true/false x16]
    note = models.CharField(max_length=10, default='C4')   # per-hit note default
    duration = models.CharField(max_length=10, default='8n')
    gain = models.FloatField(default=1.0)  # per-channel gain

    class Meta:
        ordering = ['order_index', 'id']
