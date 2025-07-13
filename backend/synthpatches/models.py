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