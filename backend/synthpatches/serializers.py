from rest_framework import serializers
from .models import Patch, Follow
from django.contrib.auth.models import User

class PatchSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.ReadOnlyField(source='uploaded_by.username')
    parent = serializers.PrimaryKeyRelatedField(queryset=Patch.objects.all(), required=False, allow_null=True)

    class Meta:
        model = Patch
        fields = [
            'id',
            'name',
            'uploaded_by',
            'parameters',
            'synth_type',
            'created_at',
            'downloads',
            'forks',
            'parent',
        ]

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username']

class FollowSerializer(serializers.ModelSerializer):
    class Meta:
        model = Follow
        fields = ['id', 'follower', 'following', 'timestamp']
        read_only_fields = ['follower', 'timestamp']
