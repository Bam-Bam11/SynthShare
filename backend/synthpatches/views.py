from collections import defaultdict, deque
import random

from django.contrib.auth.models import User
from django.db.models import Q

from rest_framework import viewsets, permissions, filters, status
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from .models import Patch, Follow, Track, DirectMessage
from .serializers import PatchSerializer, UserSerializer, FollowSerializer, TrackSerializer, DirectMessageSerializer
from .pagination import SmallPageNumberPagination


# --------------------------
# PATCHES
# --------------------------

class PatchViewSet(viewsets.ModelViewSet):
    serializer_class = PatchSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = SmallPageNumberPagination

    def get_queryset(self):
        user = self.request.user
        uploaded_by = self.request.query_params.get('uploaded_by')

        # FIXED: Use Patch.objects instead of Track.objects
        queryset = Patch.objects.all().order_by('-created_at')

        if uploaded_by:
            try:
                uploaded_by_id = int(uploaded_by)  # Convert to int for comparison
                if user.is_authenticated and user.id == uploaded_by_id:
                    queryset = queryset.filter(uploaded_by__id=uploaded_by_id)
                else:
                    queryset = queryset.filter(uploaded_by__id=uploaded_by_id, is_posted=True)
            except (ValueError, TypeError):
                # If uploaded_by is not a valid integer, return empty queryset
                queryset = queryset.none()
        else:
            queryset = queryset.filter(is_posted=True)

        return queryset

    def perform_create(self, serializer):
        serializer.save()

    def get_object(self):
        # Use with_deleted() to allow access to deleted patches for lineage/owners
        queryset = Patch.objects.with_deleted()
        patch = get_object_or_404(queryset, pk=self.kwargs['pk'])

        # If patch is deleted, only allow access to owner
        if patch.is_deleted and patch.uploaded_by != self.request.user:
            raise PermissionDenied('This patch has been deleted.')

        if patch.uploaded_by != self.request.user and not patch.is_posted:
            raise PermissionDenied('This patch is not publicly available.')

        return patch

    # ADD: Override destroy method to handle soft deletion
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.uploaded_by != request.user:
            return Response({'detail': 'Not allowed'}, status=403)
        
        # Soft delete instead of hard delete
        instance.is_deleted = True
        instance.save(update_fields=['is_deleted'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ADD: Override update method to handle is_deleted field
    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        
        # If user is trying to update is_deleted, check permissions
        if 'is_deleted' in request.data and instance.uploaded_by != request.user:
            return Response({'detail': 'Only owner can delete/restore patches'}, status=403)
            
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        return Response(serializer.data)

    # /api/patches/posted-by/<username>/?page=1&page_size=12
    @action(detail=False, methods=['get'], url_path=r'posted-by/(?P<username>[^/.]+)')
    def posted_by(self, request, username=None):
        user = get_object_or_404(User, username=username)
        # Exclude deleted patches from public listings
        qs = Patch.objects.filter(uploaded_by=user, is_posted=True).order_by('-created_at')
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = PatchSerializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)
        serializer = PatchSerializer(qs, many=True, context={'request': request})
        return Response(serializer.data)

    # /api/patches/saved-by/<username>/?page=1&page_size=12
    @action(detail=False, methods=['get'], url_path=r'saved-by/(?P<username>[^/.]+)')
    def saved_by(self, request, username=None):
        # Saved patches are private: only owner can view the list
        user = get_object_or_404(User, username=username)
        if request.user != user:
            return Response({'detail': 'Forbidden'}, status=403)
        # Owner can see their saved patches, even if deleted (for recovery)
        qs = Patch.objects.with_deleted().filter(uploaded_by=user, is_posted=False).order_by('-created_at')
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = PatchSerializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)
        serializer = PatchSerializer(qs, many=True, context={'request': request})
        return Response(serializer.data)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def post_patch(request, pk):
    try:
        # Use with_deleted() so owners can post/unpost deleted patches
        patch = Patch.objects.with_deleted().get(pk=pk, uploaded_by=request.user)
        patch.is_posted = True
        patch.save(update_fields=['is_posted'])
        return Response({'success': 'Patch has been posted.'})
    except Patch.DoesNotExist:
        return Response({'error': 'Patch not found or not owned by user.'}, status=404)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def unpost_patch(request, pk):
    try:
        # Use with_deleted() so owners can post/unpost deleted patches
        patch = Patch.objects.with_deleted().get(pk=pk, uploaded_by=request.user)
        patch.is_posted = False
        patch.save(update_fields=['is_posted'])
        return Response({'success': 'Patch has been unposted.'})
    except Patch.DoesNotExist:
        return Response({'error': 'Patch not found or not owned by user.'}, status=404)


# --------------------------
# USERS / FOLLOWS
# --------------------------

class UserViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = User.objects.all().order_by('username')
    serializer_class = UserSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['username']
    lookup_field = 'username'

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    @action(detail=True, methods=['post'])
    def follow(self, request, username=None):
        """Follow a user"""
        user_to_follow = self.get_object()
        
        if request.user == user_to_follow:
            return Response({'error': 'Cannot follow yourself'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if already following
        if Follow.objects.filter(follower=request.user, following=user_to_follow).exists():
            return Response({'error': 'Already following this user'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Create follow relationship
        Follow.objects.create(follower=request.user, following=user_to_follow)
        
        return Response({
            'status': 'followed',
            'message': f'You are now following {username}'
        })

    @action(detail=True, methods=['delete'])
    def unfollow(self, request, username=None):
        """Unfollow a user"""
        user_to_unfollow = self.get_object()
        
        try:
            follow = Follow.objects.get(follower=request.user, following=user_to_unfollow)
            follow.delete()
            return Response({
                'status': 'unfollowed',
                'message': f'You have unfollowed {username}'
            })
        except Follow.DoesNotExist:
            return Response({'error': 'Not following this user'}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'])
    def check_follow(self, request, username=None):
        """Check if current user is following this user"""
        user_to_check = self.get_object()
        
        is_following = Follow.objects.filter(
            follower=request.user, 
            following=user_to_check
        ).exists()
        
        return Response({
            'is_following': is_following,
            'username': username
        })


@api_view(['POST'])
def register(request):
    username = request.data.get('username')
    email = request.data.get('email')
    password = request.data.get('password')

    if not username or not password:
        return Response({'error': 'Username and password are required.'}, status=400)

    if User.objects.filter(username=username).exists():
        return Response({'error': 'Username already taken.'}, status=400)

    user = User.objects.create_user(username=username, email=email, password=password)
    return Response({'message': 'User created successfully'}, status=201)


@api_view(['GET'])
@permission_classes([permissions.AllowAny])  # allow viewing profiles without login
def get_user_by_username(request, username):
    try:
        user = User.objects.get(username=username)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=404)

    follower_count = Follow.objects.filter(following=user).count()
    following_count = Follow.objects.filter(follower=user).count()
    is_following = False
    if request.user.is_authenticated and request.user != user:
        is_following = Follow.objects.filter(follower=request.user, following=user).exists()

    return Response({
        'id': user.id,
        'username': user.username,
        'follower_count': follower_count,
        'following_count': following_count,
        'is_following': is_following,
    })


@api_view(['GET'])
def followers_of_user(request, username):
    try:
        target = User.objects.get(username=username)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=404)

    follower_rows = Follow.objects.filter(following=target).select_related('follower')
    followers = [f.follower for f in follower_rows]
    data = UserSerializer(followers, many=True).data
    return Response({'username': target.username, 'count': len(data), 'users': data})


@api_view(['GET'])
def following_of_user(request, username):
    try:
        target = User.objects.get(username=username)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=404)

    following_rows = Follow.objects.filter(follower=target).select_related('following')
    following = [f.following for f in following_rows]
    data = UserSerializer(following, many=True).data
    return Response({'username': target.username, 'count': len(data), 'users': data})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def current_user_view(request):
    serializer = UserSerializer(request.user)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def protected_view(request):
    return Response({'message': f'Hello, {request.user.username}! This is a protected endpoint.'})


class FollowViewSet(viewsets.ModelViewSet):
    queryset = Follow.objects.all()  # Required for DRF routing
    serializer_class = FollowSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Follow.objects.filter(follower=self.request.user)

    def perform_create(self, serializer):
        serializer.save(follower=self.request.user)

    @action(detail=False, methods=['post'], url_path='unfollow')
    def unfollow(self, request):
        following_id = request.data.get('following')
        if not following_id:
            return Response({'error': 'Following user ID is required.'}, status=400)
        try:
            follow = Follow.objects.get(follower=request.user, following_id=following_id)
            follow.delete()
            return Response({'status': 'unfollowed'})
        except Follow.DoesNotExist:
            return Response({'error': 'Not following this user.'}, status=404)


# --------------------------
# FEED / RANDOM
# --------------------------

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def feed_view(request):
    user = request.user
    followed_users = Follow.objects.filter(follower=user).values_list('following', flat=True)
    # Exclude deleted patches from feed
    qs = Patch.objects.filter(uploaded_by__in=followed_users, is_posted=True).order_by('-created_at')

    paginator = SmallPageNumberPagination()
    page = paginator.paginate_queryset(qs, request)
    serializer = PatchSerializer(page, many=True, context={'request': request})
    return paginator.get_paginated_response(serializer.data)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def tracks_feed_view(request):
    """Feed of tracks from followed users only"""
    user = request.user
    followed_users = Follow.objects.filter(follower=user).values_list('following', flat=True)
    # Exclude deleted tracks from feed
    qs = Track.objects.filter(uploaded_by__in=followed_users, is_posted=True).order_by('-created_at')

    paginator = SmallPageNumberPagination()
    page = paginator.paginate_queryset(qs, request)
    serializer = TrackSerializer(page, many=True, context={'request': request})
    return paginator.get_paginated_response(serializer.data)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def random_posted_patch(request):
    # Exclude deleted patches from random selection
    patches = list(Patch.objects.filter(is_posted=True))
    if not patches:
        return Response({'error': 'No posted patches available.'}, status=404)
    patch = random.choice(patches)
    serializer = PatchSerializer(patch)
    return Response(serializer.data)


# --------------------------
# PATCH LINEAGE
# --------------------------

@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def lineage_view(request, pk):
    """
    Patch lineage graph payload.
    """
    try:
        # Use with_deleted() to include deleted patches in lineage
        current_patch = Patch.objects.with_deleted().select_related('uploaded_by', 'root', 'immediate_predecessor').get(pk=pk)
    except Patch.DoesNotExist:
        return Response({'error': 'Patch not found.'}, status=404)

    # Handle case where root is deleted - find the effective root
    root = current_patch.root or current_patch
    
    # If the root is deleted, try to find the oldest non-deleted ancestor in the same lineage
    if root.is_deleted:
        # Find all patches with the same root ID that aren't deleted
        living_roots = Patch.objects.with_deleted().filter(
            root_id=root.id, 
            is_deleted=False
        ).order_by('created_at')
        
        if living_roots.exists():
            # Use the oldest living patch with this root as the effective root
            root = living_roots.first()
        else:
            # If all patches with this root are deleted, we have to work with what we have
            # Build the graph from all patches with this root ID, even if all are deleted
            pass

    if request.user.id == current_patch.uploaded_by_id:
        visible_q = Q(root=root)
    else:
        ancestor_ids = set()
        n = current_patch
        while n and n.id not in ancestor_ids:
            ancestor_ids.add(n.id)
            n = n.immediate_predecessor
        visible_q = Q(root=root) & (Q(is_posted=True) | Q(id__in=ancestor_ids))

    # Use with_deleted() to include deleted patches in lineage
    patches = (
        Patch.objects.with_deleted().filter(visible_q)
        .select_related('uploaded_by', 'immediate_predecessor')
        .order_by('created_at', 'id')
    )
    
    # If we have no patches but the current patch exists, include at least the current patch
    if not patches.exists() and current_patch:
        patches = Patch.objects.with_deleted().filter(id=current_patch.id)

    if not patches:
        return Response({'nodes': [], 'edges': []})

    # Rest of your existing lineage logic remains the same...
    def parse_version(ver: str):
        try:
            f_str, e_str = (ver or '0.0').split('.', 1)
            return int(f_str, 32), int(e_str, 32)
        except Exception:
            return 0, 0

    by_id = {p.id: p for p in patches}

    children = defaultdict(list)
    for p in patches:
        pred_id = getattr(p.immediate_predecessor, 'id', None)
        if pred_id and pred_id in by_id:
            children[pred_id].append(p.id)

    # Use the effective root ID for graph building
    root_id = root.id

    depth = {root_id: 0}
    q = deque([root_id])
    while q:
        cur = q.popleft()
        for cid in children.get(cur, []):
            if cid not in depth:
                depth[cid] = depth[cur] + 1
                q.append(cid)

    # Continue with your existing sibling_rank, chrono_rank, and coordinate logic...
    sibling_rank = {}
    for pred_id, kids in children.items():
        groups = defaultdict(list)
        for cid in kids:
            f_idx, _ = parse_version(by_id[cid].version)
            groups[f_idx].append(cid)
        for f_idx, arr in groups.items():
            arr.sort(key=lambda cid: (parse_version(by_id[cid].version)[1], by_id[cid].created_at, cid))
            for i, cid in enumerate(arr, start=1):
                sibling_rank[cid] = i
    sibling_rank.setdefault(root_id, 0)

    chrono_rank = {}
    fork_groups = defaultdict(list)
    for p in patches:
        f_idx, _ = parse_version(p.version)
        fork_groups[f_idx].append(p)
    for f_idx, arr in fork_groups.items():
        arr.sort(key=lambda p: (p.created_at, p.id))
        for i, p in enumerate(arr):
            chrono_rank[p.id] = i

    X0, Y0 = 120, 640
    COL_GAP = 160
    ROW_GAP = 90

    coords = {}
    taken_rows = defaultdict(set)

    placement = sorted(
        patches,
        key=lambda p: (parse_version(p.version)[0], p.created_at, p.id)
    )

    for p in placement:
        f_idx, _ = parse_version(p.version)
        base_d = depth.get(p.id, 0)
        s_rank = sibling_rank.get(p.id, 1)
        c_rank = chrono_rank.get(p.id, 0)

        proposed_row = max(base_d + max(0, s_rank - 1), c_rank)

        while proposed_row in taken_rows[f_idx]:
            proposed_row += 1
        taken_rows[f_idx].add(proposed_row)

        x = X0 + f_idx * COL_GAP
        y = Y0 - proposed_row * ROW_GAP
        coords[p.id] = (x, y)

    edges = []
    for p in patches:
        pred_id = getattr(p.immediate_predecessor, 'id', None)
        if pred_id and pred_id in coords and p.id in coords:
            edges.append({'from': pred_id, 'to': p.id})

    nodes = []
    for p in patches:
        x, y = coords[p.id]
        f_idx, _ = parse_version(p.version)
        nodes.append({
            'id': p.id,
            'name': p.name,
            'version': p.version,
            'downloads': p.downloads,
            'is_posted': p.is_posted,
            'is_deleted': p.is_deleted,
            'uploaded_by': p.uploaded_by.username,
            'isCurrent': (p.id == current_patch.id),
            'stem': p.stem_id,
            'immediate_predecessor': getattr(p.immediate_predecessor, 'id', None),
            'sibling_rank': sibling_rank.get(p.id, 1),
            'column': f_idx,
            'x': x,
            'y': y,
        })

    return Response({'nodes': nodes, 'edges': edges})

# --------------------------
# TRACKS
# --------------------------

@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def track_lineage_view(request, pk):
    """
    Track lineage graph payload (matches patch layout rules).
    """
    try:
        # Use with_deleted() to include deleted tracks in lineage
        current_track = Track.objects.with_deleted().select_related('uploaded_by', 'root', 'immediate_predecessor').get(pk=pk)
    except Track.DoesNotExist:
        return Response({'error': 'Track not found.'}, status=404)

    # Handle case where root is deleted - find the effective root
    root = current_track.root or current_track
    
    # If the root is deleted, try to find the oldest non-deleted ancestor in the same lineage
    if root.is_deleted:
        # Find all tracks with the same root ID that aren't deleted
        living_roots = Track.objects.with_deleted().filter(
            root_id=root.id, 
            is_deleted=False
        ).order_by('created_at')
        
        if living_roots.exists():
            # Use the oldest living track with this root as the effective root
            root = living_roots.first()
        else:
            # If all tracks with this root are deleted, we have to work with what we have
            # Build the graph from all tracks with this root ID, even if all are deleted
            pass

    if request.user.id == current_track.uploaded_by_id:
        visible_q = Q(root=root)
    else:
        ancestor_ids = set()
        n = current_track
        while n and n.id not in ancestor_ids:
            ancestor_ids.add(n.id)
            n = n.immediate_predecessor
        visible_q = Q(root=root) & (Q(is_posted=True) | Q(id__in=ancestor_ids))

    # Use with_deleted() to include deleted tracks in lineage
    tracks = (
        Track.objects.with_deleted().filter(visible_q)
        .select_related('uploaded_by', 'immediate_predecessor')
        .order_by('created_at', 'id')
    )
    
    # If we have no tracks but the current track exists, include at least the current track
    if not tracks.exists() and current_track:
        tracks = Track.objects.with_deleted().filter(id=current_track.id)

    if not tracks:
        return Response({'nodes': [], 'edges': []})

    def parse_version(ver: str):
        try:
            f_str, e_str = (ver or '0.0').split('.', 1)
            return int(f_str, 32), int(e_str, 32)
        except Exception:
            return 0, 0

    by_id = {t.id: t for t in tracks}

    children = defaultdict(list)
    for t in tracks:
        pred_id = getattr(t.immediate_predecessor, 'id', None)
        if pred_id and pred_id in by_id:
            children[pred_id].append(t.id)

    # Use the effective root ID for graph building
    root_id = root.id

    depth = {root_id: 0}
    q = deque([root_id])
    while q:
        cur = q.popleft()
        for cid in children.get(cur, []):
            if cid not in depth:
                depth[cid] = depth[cur] + 1
                q.append(cid)

    sibling_rank = {}
    for pred_id, kids in children.items():
        groups = defaultdict(list)   # fork_idx -> [child_id]
        for cid in kids:
            f_idx, _ = parse_version(by_id[cid].version)
            groups[f_idx].append(cid)
        for f_idx, arr in groups.items():
            arr.sort(key=lambda cid: (parse_version(by_id[cid].version)[1], by_id[cid].created_at, cid))
            for i, cid in enumerate(arr, start=1):
                sibling_rank[cid] = i
    sibling_rank.setdefault(root_id, 0)

    chrono_rank = {}
    fork_groups = defaultdict(list)
    for t in tracks:
        f_idx, _ = parse_version(t.version)
        fork_groups[f_idx].append(t)
    for f_idx, arr in fork_groups.items():
        arr.sort(key=lambda t: (t.created_at, t.id))
        for i, t in enumerate(arr):
            chrono_rank[t.id] = i

    X0, Y0 = 120, 640
    COL_GAP = 160
    ROW_GAP = 90
    coords = {}
    taken_rows = defaultdict(set)

    placement = sorted(tracks, key=lambda t: (parse_version(t.version)[0], t.created_at, t.id))
    for t in placement:
        f_idx, _ = parse_version(t.version)
        base_d = depth.get(t.id, 0)
        s_rank = sibling_rank.get(t.id, 1)
        c_rank = chrono_rank.get(t.id, 0)
        proposed_row = max(base_d + max(0, s_rank - 1), c_rank)
        while proposed_row in taken_rows[f_idx]:
            proposed_row += 1
        taken_rows[f_idx].add(proposed_row)
        x = X0 + f_idx * COL_GAP
        y = Y0 - proposed_row * ROW_GAP
        coords[t.id] = (x, y)

    edges = []
    for t in tracks:
        pred_id = getattr(t.immediate_predecessor, 'id', None)
        if pred_id and pred_id in coords and t.id in coords:
            edges.append({'from': pred_id, 'to': t.id})

    nodes = []
    for t in tracks:
        x, y = coords[t.id]
        f_idx, _ = parse_version(t.version)
        nodes.append({
            'id': t.id,
            'name': t.name,
            'version': t.version,
            'downloads': t.downloads,
            'is_posted': t.is_posted,
            'is_deleted': t.is_deleted,  # Add deletion status for frontend
            'uploaded_by': t.uploaded_by.username,
            'isCurrent': (t.id == current_track.id),
            'stem': t.stem_id,
            'immediate_predecessor': getattr(t.immediate_predecessor, 'id', None),
            'sibling_rank': sibling_rank.get(t.id, 1),
            'column': f_idx,
            'x': x,
            'y': y,
        })

    return Response({'nodes': nodes, 'edges': edges})


class TrackViewSet(viewsets.ModelViewSet):
    serializer_class = TrackSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = SmallPageNumberPagination

    def get_queryset(self):
        user = self.request.user
        uploaded_by = self.request.query_params.get('uploaded_by')
        # Use default manager to exclude deleted tracks
        qs = Track.objects.all().order_by('-created_at')

        if uploaded_by:
            try:
                uploaded_by_id = int(uploaded_by)  # Convert to int for comparison
                if user.is_authenticated and user.id == uploaded_by_id:
                    qs = qs.filter(uploaded_by__id=uploaded_by_id)
                else:
                    qs = qs.filter(uploaded_by__id=uploaded_by_id, is_posted=True)
            except (ValueError, TypeError):
                # If uploaded_by is not a valid integer, return empty queryset
                qs = qs.none()
        else:
            qs = qs.filter(is_posted=True)

        return qs.select_related('uploaded_by')

    def get_object(self):
        # Use with_deleted() to allow access to deleted tracks for lineage/owners
        qs = Track.objects.with_deleted().select_related('uploaded_by')
        track = get_object_or_404(qs, pk=self.kwargs['pk'])
        
        # If track is deleted, only allow access to owner
        if track.is_deleted and track.uploaded_by != self.request.user:
            self.permission_denied(self.request, message='This track has been deleted.')
            
        if track.uploaded_by != self.request.user and not track.is_posted:
            self.permission_denied(self.request, message='This track is not publicly available.')
        return track

    # ADD: Override destroy method to handle soft deletion
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.uploaded_by != request.user:
            return Response({'detail': 'Not allowed'}, status=403)
        
        # Soft delete instead of hard delete
        instance.is_deleted = True
        instance.save(update_fields=['is_deleted'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ADD: Override update method to handle is_deleted field
    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        
        # If user is trying to update is_deleted, check permissions
        if 'is_deleted' in request.data and instance.uploaded_by != request.user:
            return Response({'detail': 'Only owner can delete/restore tracks'}, status=403)
            
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        return Response(serializer.data)

    # POST /tracks/<id>/post/
    @action(detail=True, methods=['post'])
    def post(self, request, pk=None):
        # Use with_deleted() so owners can post/unpost deleted tracks
        track = get_object_or_404(Track.objects.with_deleted().select_related('uploaded_by'), pk=pk)
        if track.uploaded_by_id != request.user.id:
            return Response({'detail': 'Only the owner can post this track.'}, status=status.HTTP_403_FORBIDDEN)
        if not track.is_posted:
            track.is_posted = True
            track.save(update_fields=['is_posted'])
        data = self.get_serializer(track, context={'request': request}).data
        return Response(data)

    # POST /tracks/<id>/unpost/
    @action(detail=True, methods=['post'])
    def unpost(self, request, pk=None):
        # Use with_deleted() so owners can post/unpost deleted tracks
        track = get_object_or_404(Track.objects.with_deleted().select_related('uploaded_by'), pk=pk)
        if track.uploaded_by_id != request.user.id:
            return Response({'detail': 'Only the owner can unpost this track.'}, status=status.HTTP_403_FORBIDDEN)
        if track.is_posted:
            track.is_posted = False
            track.save(update_fields=['is_posted'])
        data = self.get_serializer(track, context={'request': request}).data
        return Response(data)

    # GET /tracks/posted-by/<username>/?page=1&page_size=12
    @action(detail=False, methods=['get'], url_path=r'posted-by/(?P<username>[^/.]+)')
    def posted_by(self, request, username=None):
        user = get_object_or_404(User, username=username)
        # Exclude deleted tracks from public listings
        qs = Track.objects.filter(uploaded_by=user, is_posted=True).order_by('-created_at')
        page = self.paginate_queryset(qs)
        ser = TrackSerializer(page or qs, many=True, context={'request': request})
        return self.get_paginated_response(ser.data) if page is not None else Response(ser.data)

    # GET /tracks/saved-by/<username>/?page=1&page_size=12
    @action(detail=False, methods=['get'], url_path=r'saved-by/(?P<username>[^/.]+)')
    def saved_by(self, request, username=None):
        user = get_object_or_404(User, username=username)
        if request.user != user:
            return Response({'detail': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)
        # Owner can see their saved tracks, even if deleted (for recovery)
        qs = Track.objects.with_deleted().filter(uploaded_by=user, is_posted=False).order_by('-created_at')
        page = self.paginate_queryset(qs)
        ser = TrackSerializer(page or qs, many=True, context={'request': request})
        return self.get_paginated_response(ser.data) if page is not None else Response(ser.data)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def fork_track(request, pk):
    """
    Create a new Track as a fork of pk. Client may optionally pass a mutated composition/items payload.
    """
    # Use with_deleted() to allow forking from deleted tracks
    parent = get_object_or_404(Track.objects.with_deleted(), pk=pk)
    data = request.data.copy()
    data['root'] = parent.root_id or parent.id
    data['stem'] = parent.id
    data['immediate_predecessor'] = parent.id
    serializer = TrackSerializer(data=data, context={'request': request})
    serializer.is_valid(raise_exception=True)
    track = serializer.save()
    return Response(TrackSerializer(track, context={'request': request}).data, status=201)

class DirectMessageViewSet(viewsets.ModelViewSet):
    serializer_class = DirectMessageSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = DirectMessage.objects.filter(
            Q(sender=user) | Q(recipient=user)
        )

        # Optional: filter to a single conversation
        other_user_id = self.request.query_params.get('other_user')
        if other_user_id:
            qs = qs.filter(
                (Q(sender=user) & Q(recipient_id=other_user_id)) |
                (Q(recipient=user) & Q(sender_id=other_user_id))
            )
        return qs.order_by('created_at')

    def perform_create(self, serializer):
        # sender forced to current user
        serializer.save(sender=self.request.user)

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        count = DirectMessage.objects.filter(
            recipient=request.user,
            is_read=False
        ).count()
        return Response({'unread_count': count})

    @action(detail=False, methods=['post'])
    def mark_conversation_read(self, request):
        """
        POST /api/messages/mark_conversation_read/
        body: { "other_user": <id> }
        Marks all messages from other_user → current user as read.
        """
        other = request.data.get('other_user')
        if not other:
            return Response({'detail': 'other_user is required.'}, status=status.HTTP_400_BAD_REQUEST)

        qs = DirectMessage.objects.filter(
            sender_id=other,
            recipient=request.user,
            is_read=False,
        )
        updated = qs.update(is_read=True)
        return Response({'updated': updated})

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        """Mark a single message as read."""
        msg = self.get_object()
        if msg.recipient != request.user:
            return Response({'detail': 'You may only mark your own received messages as read.'},
                            status=status.HTTP_403_FORBIDDEN)
        if not msg.is_read:
            msg.is_read = True
            msg.save(update_fields=['is_read'])
        return Response({'status': 'ok'})