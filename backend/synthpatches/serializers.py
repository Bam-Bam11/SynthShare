from rest_framework import serializers
from .models import Patch, Follow
from django.contrib.auth.models import User

class PatchSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.ReadOnlyField(source='uploaded_by.username')
    uploaded_by_id = serializers.ReadOnlyField(source='uploaded_by.id')
    root = serializers.PrimaryKeyRelatedField(queryset=Patch.objects.all(), required=False, allow_null=True)
    stem = serializers.PrimaryKeyRelatedField(queryset=Patch.objects.all(), required=False, allow_null=True)
    immediate_predecessor = serializers.PrimaryKeyRelatedField(queryset=Patch.objects.all(), required=False, allow_null=True)

    class Meta:
        model = Patch
        fields = [
            'id',
            'name',
            'description',
            'uploaded_by',
            'uploaded_by_id',
            'parameters',
            'synth_type',
            'note',
            'duration',
            'created_at',
            'downloads',
            'forks',
            'root',
            'stem',
            'immediate_predecessor',
            'version',
            'is_posted',
        ]
        read_only_fields = ['uploaded_by', 'downloads', 'forks', 'created_at']

    def create(self, validated_data):
        patch = Patch(**validated_data)  # Do not pass uploaded_by here
        patch.save()
        return patch


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username']

class FollowSerializer(serializers.ModelSerializer):
    class Meta:
        model = Follow
        fields = ['id', 'follower', 'following', 'timestamp']
        read_only_fields = ['follower', 'timestamp']
