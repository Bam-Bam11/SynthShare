from django.db import transaction
from django.core.exceptions import ObjectDoesNotExist
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from django.contrib.auth.models import User

from .models import Patch, Follow, Track


# --------------------------
# PATCHES
# --------------------------

class PatchSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.ReadOnlyField(source='uploaded_by.username')
    uploaded_by_id = serializers.ReadOnlyField(source='uploaded_by.id')

    root = serializers.PrimaryKeyRelatedField(queryset=Patch.objects.all(), required=False, allow_null=True)
    stem = serializers.PrimaryKeyRelatedField(queryset=Patch.objects.all(), required=False, allow_null=True)
    immediate_predecessor = serializers.PrimaryKeyRelatedField(
        queryset=Patch.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = Patch
        fields = [
            'id', 'name', 'description',
            'uploaded_by', 'uploaded_by_id',
            'parameters', 'synth_type', 'note', 'duration',
            'created_at', 'downloads', 'forks',
            'root', 'stem', 'immediate_predecessor',
            'version', 'is_posted',
        ]
        read_only_fields = ['uploaded_by', 'downloads', 'forks', 'created_at', 'version']

    def create(self, validated_data):
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
# TRACKS (composition JSON)
# --------------------------

class TrackSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.ReadOnlyField(source='uploaded_by.username')
    uploaded_by_id = serializers.ReadOnlyField(source='uploaded_by.id')

    # Accept/return composition as-is, but validate structure in .validate()
    composition = serializers.JSONField(required=False)

    root = serializers.PrimaryKeyRelatedField(queryset=Track.objects.all(), required=False, allow_null=True)
    stem = serializers.PrimaryKeyRelatedField(queryset=Track.objects.all(), required=False, allow_null=True)
    immediate_predecessor = serializers.PrimaryKeyRelatedField(
        queryset=Track.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = Track
        fields = [
            'id', 'name', 'description',
            'composition',
            'uploaded_by', 'uploaded_by_id',
            'bpm', 'created_at', 'downloads', 'forks',
            'root', 'stem', 'immediate_predecessor',
            'version', 'is_posted',
        ]
        read_only_fields = ['uploaded_by', 'downloads', 'forks', 'created_at', 'version']

    # --- schema/consistency checks for composition ---
    def _validate_composition(self, comp):
        if comp in (None, {}):
            return {"version": 1, "items": []}

        if not isinstance(comp, dict):
            raise ValidationError({'composition': 'Must be an object.'})

        items = comp.get('items')
        if items is None:
            comp['items'] = items = []

        if not isinstance(items, list):
            raise ValidationError({'composition': '"items" must be a list.'})

        # Gather & check IDs and fields
        patch_ids = []
        for i, row in enumerate(items):
            if not isinstance(row, dict):
                raise ValidationError({'composition': f'Item {i} must be an object.'})

            missing = [k for k in ('patch', 'lane', 'start', 'end') if k not in row]
            if missing:
                raise ValidationError({'composition': f'Item {i} missing {missing}.'})

            try:
                row['patch'] = int(row['patch'])
                row['lane'] = int(row['lane'])
                row['start'] = float(row['start'])
                row['end'] = float(row['end'])
            except Exception:
                raise ValidationError({'composition': f'Item {i} has non-numeric fields.'})

            if row['lane'] < 0:
                raise ValidationError({'composition': f'Item {i}: lane must be >= 0.'})
            if row['start'] < 0:
                raise ValidationError({'composition': f'Item {i}: start must be >= 0.'})
            if row['end'] <= row['start']:
                raise ValidationError({'composition': f'Item {i}: end must be > start.'})

            if 'label' in row and row['label'] is None:
                row['label'] = ''

            patch_ids.append(row['patch'])

        # Referential integrity for patches
        if patch_ids:
            existing = set(Patch.objects.filter(id__in=patch_ids).values_list('id', flat=True))
            missing = [pid for pid in patch_ids if pid not in existing]
            if missing:
                raise ValidationError({'composition': f'Unknown patch id(s): {missing}'})

        # Normalize version
        if 'version' not in comp:
            comp['version'] = 1
        return comp

    def validate(self, attrs):
        comp = attrs.get('composition', None)
        attrs['composition'] = self._validate_composition(comp)
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        request = self.context.get('request')
        if not request or not request.user or not request.user.is_authenticated:
            raise ValidationError({'detail': 'Authentication required to create a track.'})
        user = request.user

        validated_data.pop('uploaded_by', None)

        root = validated_data.pop('root', None)
        source = validated_data.pop('stem', None)
        validated_data.pop('immediate_predecessor', None)

        for key in ('name', 'bpm'):
            if key not in validated_data:
                raise ValidationError({key: f'{key} is required.'})

        try:
            if source is None and root is None:
                track = Track.create_root(uploaded_by=user, **validated_data)
            else:
                if source is None and root is not None:
                    source = root
                if source is None:
                    raise ValidationError({'stem': 'A valid stem (source track id) is required for edit/fork.'})
                if source.uploaded_by_id == user.id:
                    track = Track.edit_from(source, uploaded_by=user, **validated_data)
                else:
                    track = Track.fork_from(source, uploaded_by=user, **validated_data)

            track.refresh_from_db()
            return track

        except ValidationError:
            raise
        except Exception as e:
            raise ValidationError({'detail': f'Create failed: {e.__class__.__name__}: {e}'})

    @transaction.atomic
    def update(self, instance, validated_data):
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        return instance
