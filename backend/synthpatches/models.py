from django.db import models
from django.contrib.auth.models import User

class Patch(models.Model):
    name = models.CharField(max_length=100)
    parameters = models.JSONField()
    synth_type = models.CharField(max_length=50, default='basic')
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)  # New: timestamp
    downloads = models.PositiveIntegerField(default=0)    # New: download count
    forks = models.PositiveIntegerField(default=0)        # New: fork count

    def __str__(self):
        return f"{self.name} by {self.uploaded_by.username}"
