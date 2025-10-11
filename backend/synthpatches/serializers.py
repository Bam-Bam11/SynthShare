from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from django.contrib.auth.models import User
from django.core.exceptions import ObjectDoesNotExist
from .models import Patch, Follow, Track, TrackItem, SavedTrack


# --------------------------
# PATCHES
# --------------------------

class PatchSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.ReadOnlyField(source='uploaded_by.username')
    uploaded_by_id = serializers.ReadOnlyField(source='uploaded_by.id')

    # Lineage hints (IDs accepted)
    root = serializers.PrimaryKeyRelatedField(queryset=Patch.objects.all(), required=False, allow_null=True)
    stem = serializers.PrimaryKeyRelatedField(queryset=Patch.objects.all(), required=False, allow_null=True)
    immediate_predecessor = serializers.PrimaryKeyRelatedField(
        queryset=Patch.objects.all(), required=False, allow_null=True
    )

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
        # Protect server-assigned versioning/lineage
        read_only_fields = ['uploaded_by', 'downloads', 'forks', 'created_at', 'version']

    def create(self, validated_data):
        """
        Route creation to the correct constructor so version/root/stem/immediate_predecessor are correct:
          - No root/stem  -> Patch.create_root (0.0)
          - stem given    -> same-user: Patch.edit_from(source), other-user: Patch.fork_from(source)
        If only root is given (no stem), treat as edit-from-root.
        """
        request = self.context.get('request')
        if not request or not request.user or not request.user.is_authenticated:
            raise ValidationError({'detail': 'Authentication required to create a patch.'})
        user = request.user

        validated_data.pop('uploaded_by', None)

        root = validated_data.pop('root', None)
        source = validated_data.pop('stem', None)
        validated_data.pop('immediate_predecessor', None)

        for key in ('name', 'parameters', 'synth_type'):
            if key not in validated_data:
                raise ValidationError({key: f'{key} is required.'})

        try:
            if source is None and root is None:
                obj = Patch.create_root(uploaded_by=user, **validated_data)
                obj.refresh_from_db()
                return obj

            if source is None and root is not None:
                source = root

            if source is None:
                raise ValidationError({'stem': 'A valid stem (source patch id) is required for edit/fork.'})

            if source.uploaded_by_id == user.id:
                obj = Patch.edit_from(source, uploaded_by=user, **validated_data)
            else:
                obj = Patch.fork_from(source, uploaded_by=user, **validated_data)

            obj.refresh_from_db()
            return obj

        except ObjectDoesNotExist as e:
            raise ValidationError({'detail': f'Invalid lineage reference: {e}'})
        except ValidationError:
            raise
        except Exception as e:
            raise ValidationError({'detail': f'Create failed: {e.__class__.__name__}: {e}'})


# --------------------------
# USERS / FOLLOWS
# --------------------------

class UserSerializer(serializers.ModelSerializer):
    follower_count = serializers.SerializerMethodField()
    following_count = serializers.SerializerMethodField()
    is_following = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'follower_count', 'following_count', 'is_following']

    def get_follower_count(self, obj):
        return obj.followers.count()

    def get_following_count(self, obj):
        return obj.following.count()

    def get_is_following(self, obj):
        req = self.context.get('request')
        if not req or not req.user or not req.user.is_authenticated:
            return False
        return obj.followers.filter(follower=req.user).exists()


class FollowSerializer(serializers.ModelSerializer):
    class Meta:
        model = Follow
        fields = ['id', 'follower', 'following', 'timestamp']
        read_only_fields = ['follower', 'timestamp']


# --------------------------
# TRACKS (with nested items)
# --------------------------

class TrackItemSerializer(serializers.ModelSerializer):
    # include minimal patch info for UI and the id for linking
    patch_name = serializers.ReadOnlyField(source='patch.name')
    patch_uploaded_by = serializers.ReadOnlyField(source='patch.uploaded_by.username')

    class Meta:
        model = TrackItem
        fields = [
            'id',
            'order_index',
            'patch',
            'patch_name',
            'patch_uploaded_by',
            'patch_snapshot',
            'start_beat',
            'length_beats',
            'label',
        ]
        read_only_fields = ['patch_snapshot']

    def validate(self, attrs):
        sb = attrs.get('start_beat', 0.0)
        lb = attrs.get('length_beats', 1.0)
        if sb < 0:
            raise ValidationError({'start_beat': 'start_beat must be >= 0.'})
        if lb <= 0:
            raise ValidationError({'length_beats': 'length_beats must be > 0.'})
        return attrs


class TrackSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.ReadOnlyField(source='uploaded_by.username')
    uploaded_by_id = serializers.ReadOnlyField(source='uploaded_by.id')
    items = TrackItemSerializer(many=True, required=False)
    is_saved = serializers.SerializerMethodField()

    # lineage (mirrors Patch)
    root = serializers.PrimaryKeyRelatedField(queryset=Track.objects.all(), required=False, allow_null=True)
    stem = serializers.PrimaryKeyRelatedField(queryset=Track.objects.all(), required=False, allow_null=True)
    immediate_predecessor = serializers.PrimaryKeyRelatedField(
        queryset=Track.objects.all(), required=False, allow_null=True
    )

    def get_is_saved(self, obj):
        req = self.context.get('request')
        if not req or not req.user or not req.user.is_authenticated:
            return False
        return SavedTrack.objects.filter(user=req.user, track=obj).exists()

    class Meta:
        model = Track
        fields = [
            'id', 'name', 'description', 'uploaded_by', 'uploaded_by_id',
            'bpm', 'created_at', 'downloads', 'forks',
            'root', 'stem', 'immediate_predecessor', 'version', 'is_posted',
            'items', 'is_saved'
        ]
        read_only_fields = ['uploaded_by', 'downloads', 'forks', 'created_at', 'version']

    def create(self, validated_data):
        """
        Preserve nested TrackItem creation (with patch_snapshot freezing) and
        route the Track create through lineage-aware constructors.
        """
        request = self.context.get('request')
        if not request or not request.user or not request.user.is_authenticated:
            raise ValidationError({'detail': 'Authentication required to create a track.'})
        user = request.user

        validated_data.pop('uploaded_by', None)

        items_data = validated_data.pop('items', [])

        # lineage hints (do not trust client for predecessor)
        root = validated_data.pop('root', None)
        source = validated_data.pop('stem', None)
        validated_data.pop('immediate_predecessor', None)

        for key in ('name', 'bpm'):
            if key not in validated_data:
                raise ValidationError({key: f'{key} is required.'})

        try:
            # decide root/edit/fork
            if source is None and root is None:
                obj = Track.create_root(uploaded_by=user, **validated_data)
            else:
                if source is None and root is not None:
                    source = root
                if source is None:
                    raise ValidationError({'stem': 'A valid stem (source track id) is required for edit/fork.'})
                if source.uploaded_by_id == user.id:
                    obj = Track.edit_from(source, uploaded_by=user, **validated_data)
                else:
                    obj = Track.fork_from(source, uploaded_by=user, **validated_data)

            obj.refresh_from_db()  # ensure version/root/stem are current in the response

            # create items (freeze each patch's parameters)
            for i, item in enumerate(items_data):
                patch_ref = item.get('patch')
                patch_id = patch_ref.id if isinstance(patch_ref, Patch) else patch_ref
                if patch_id is None:
                    raise ValidationError({'items': f'Item {i}: "patch" is required.'})
                try:
                    patch = Patch.objects.get(pk=patch_id)
                except Patch.DoesNotExist:
                    raise ValidationError({'items': f'Item {i}: patch id {patch_id} does not exist.'})

                start_beat = item.get('start_beat', 0.0)
                length_beats = item.get('length_beats', 1.0)
                label = item.get('label', '')

                if start_beat < 0:
                    raise ValidationError({'items': f'Item {i}: start_beat must be >= 0.'})
                if length_beats <= 0:
                    raise ValidationError({'items': f'Item {i}: length_beats must be > 0.'})

                TrackItem.objects.create(
                    track=obj,
                    order_index=item.get('order_index', i),
                    patch=patch,
                    patch_snapshot=patch.parameters,
                    start_beat=start_beat,
                    length_beats=length_beats,
                    label=label,
                )

            return obj

        except ValidationError:
            raise
        except Exception as e:
            raise ValidationError({'detail': f'Create failed: {e.__class__.__name__}: {e}'})

    def update(self, instance, validated_data):
        """
        Replace-all strategy for items (same behaviour you had).
        """
        items_data = validated_data.pop('items', None)

        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()

        if items_data is not None:
            instance.items.all().delete()
            for i, item in enumerate(items_data):
                patch_ref = item.get('patch')
                patch_id = patch_ref.id if isinstance(patch_ref, Patch) else patch_ref
                if patch_id is None:
                    raise ValidationError({'items': f'Item {i}: "patch" is required.'})
                try:
                    patch = Patch.objects.get(pk=patch_id)
                except Patch.DoesNotExist:
                    raise ValidationError({'items': f'Item {i}: patch id {patch_id} does not exist.'})

                start_beat = item.get('start_beat', 0.0)
                length_beats = item.get('length_beats', 1.0)
                label = item.get('label', '')

                if start_beat < 0:
                    raise ValidationError({'items': f'Item {i}: start_beat must be >= 0.'})
                if length_beats <= 0:
                    raise ValidationError({'items': f'Item {i}: length_beats must be > 0.'})

                TrackItem.objects.create(
                    track=instance,
                    order_index=item.get('order_index', i),
                    patch=patch,
                    patch_snapshot=patch.parameters,
                    start_beat=start_beat,
                    length_beats=length_beats,
                    label=label,
                )

        return instance
