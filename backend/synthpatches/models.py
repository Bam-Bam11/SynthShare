from django.db import models
from django.contrib.auth.models import User

class Patch(models.Model):
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=500, blank=True, default='')
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='patches')
    parameters = models.JSONField()
    synth_type = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)
    downloads = models.PositiveIntegerField(default=0)
    forks = models.PositiveIntegerField(default=0)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='children')
    note = models.CharField(max_length=10, default='C4')
    duration = models.CharField(max_length=10, default='8n')

    def __str__(self):
        return self.name

class Follow(models.Model):
    follower = models.ForeignKey(User, related_name='following', on_delete=models.CASCADE)
    following = models.ForeignKey(User, related_name='followers', on_delete=models.CASCADE)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('follower', 'following')  # prevent duplicates

    def __str__(self):
        return f"{self.follower.username} follows {self.following.username}"