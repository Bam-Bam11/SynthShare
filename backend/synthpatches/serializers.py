from rest_framework import serializers
from .models import Patch

class PatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Patch
        fields = '__all__'
        read_only_fields = ['uploaded_by', 'download_count', 'created_at']