from rest_framework import serializers
from .models import Patch, Follow, Track, TrackItem
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
    follower_count = serializers.SerializerMethodField()
    following_count = serializers.SerializerMethodField()
    is_following = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'follower_count', 'following_count', 'is_following']

    def get_follower_count(self, obj):
        # people who follow `obj`
        return obj.followers.count()

    def get_following_count(self, obj):
        # people `obj` is following
        return obj.following.count()

    def get_is_following(self, obj):
        # whether request.user follows `obj`
        req = self.context.get('request')
        if not req or not req.user or not req.user.is_authenticated:
            return False
        return obj.followers.filter(follower=req.user).exists()

class FollowSerializer(serializers.ModelSerializer):
    class Meta:
        model = Follow
        fields = ['id', 'follower', 'following', 'timestamp']
        read_only_fields = ['follower', 'timestamp']

# serializers.py

class TrackItemSerializer(serializers.ModelSerializer):
    # include minimal patch info for UI and the id for linking
    patch_name = serializers.ReadOnlyField(source='patch.name')
    patch_uploaded_by = serializers.ReadOnlyField(source='patch.uploaded_by.username')

    class Meta:
        model = TrackItem
        fields = [
            'id', 'order_index', 'patch', 'patch_name', 'patch_uploaded_by',
            'patch_snapshot', 'steps', 'note', 'duration', 'gain'
        ]
        read_only_fields = ['patch_snapshot']

class TrackSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.ReadOnlyField(source='uploaded_by.username')
    uploaded_by_id = serializers.ReadOnlyField(source='uploaded_by.id')
    items = TrackItemSerializer(many=True)

    class Meta:
        model = Track
        fields = [
            'id', 'name', 'description', 'uploaded_by', 'uploaded_by_id',
            'bpm', 'time_signature', 'created_at', 'downloads', 'forks',
            'root', 'stem', 'immediate_predecessor', 'version', 'is_posted',
            'items'
        ]
        read_only_fields = ['uploaded_by', 'downloads', 'forks', 'created_at', 'version']

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        track = Track.objects.create(uploaded_by=self.context['request'].user, **validated_data)
        for i, item in enumerate(items_data):
            patch = Patch.objects.get(pk=item['patch'].id if isinstance(item['patch'], Patch) else item['patch'])
            TrackItem.objects.create(
                track=track,
                order_index=item.get('order_index', i),
                patch=patch,
                patch_snapshot=patch.parameters,  # freeze current parameters
                steps=item.get('steps', [False]*16),
                note=item.get('note', 'C4'),
                duration=item.get('duration', '8n'),
                gain=item.get('gain', 1.0),
            )
        return track

    def update(self, instance, validated_data):
        # simple replace-all strategy for MVP
        items_data = validated_data.pop('items', None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if items_data is not None:
            instance.items.all().delete()
            for i, item in enumerate(items_data):
                patch = Patch.objects.get(pk=item['patch'])
                TrackItem.objects.create(
                    track=instance,
                    order_index=item.get('order_index', i),
                    patch=patch,
                    patch_snapshot=patch.parameters,
                    steps=item.get('steps', [False]*16),
                    note=item.get('note', 'C4'),
                    duration=item.get('duration', '8n'),
                    gain=item.get('gain', 1.0),
                )
        return instance
