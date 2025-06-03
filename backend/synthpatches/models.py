from django.db import models
from django.contrib.auth.models import User

class Patch(models.Model):
    name = models.CharField(max_length=255)
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE)
    parent_patch = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='children')
    parameters = models.JSONField()
    synth_type = models.CharField(max_length=100)
    download_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.uploaded_by.username})"
