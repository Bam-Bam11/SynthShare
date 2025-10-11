from rest_framework import viewsets, permissions, filters
from rest_framework.generics import get_object_or_404
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response
from django.contrib.auth.models import User
from rest_framework.exceptions import PermissionDenied
from .models import Patch, Follow, Track
from .serializers import PatchSerializer, UserSerializer, FollowSerializer, TrackSerializer
import random
from .pagination import SmallPageNumberPagination
from django.db.models import Q
from collections import defaultdict, deque


# PATCH API VIEWSET
class PatchViewSet(viewsets.ModelViewSet):
    serializer_class = PatchSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    pagination_class = SmallPageNumberPagination

    def get_queryset(self):
        user = self.request.user
        uploaded_by = self.request.query_params.get('uploaded_by')

        queryset = Patch.objects.all().order_by('-created_at')

        if uploaded_by:
            if str(user.id) == uploaded_by:
                queryset = queryset.filter(uploaded_by__id=uploaded_by)
            else:
                queryset = queryset.filter(uploaded_by__id=uploaded_by, is_posted=True)
        else:
            queryset = queryset.filter(is_posted=True)

        return queryset

    def perform_create(self, serializer):
        serializer.save()

    def get_object(self):
        queryset = Patch.objects.all()
        patch = get_object_or_404(queryset, pk=self.kwargs['pk'])

        if patch.uploaded_by != self.request.user and not patch.is_posted:
            raise PermissionDenied('This patch is not publicly available.')

        return patch

    # /api/patches/posted-by/<username>/?page=1&page_size=12
    @action(detail=False, methods=['get'], url_path=r'posted-by/(?P<username>[^/.]+)')
    def posted_by(self, request, username=None):
        user = get_object_or_404(User, username=username)
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
        qs = Patch.objects.filter(uploaded_by=user, is_posted=False).order_by('-updated_at')
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
        patch = Patch.objects.get(pk=pk, uploaded_by=request.user)
        patch.is_posted = True
        patch.save()
        return Response({'success': 'Patch has been posted.'})
    except Patch.DoesNotExist:
        return Response({'error': 'Patch not found or not owned by user.'}, status=404)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def unpost_patch(request, pk):
    try:
        patch = Patch.objects.get(pk=pk, uploaded_by=request.user)
        patch.is_posted = False
        patch.save()
        return Response({'success': 'Patch has been unposted.'})
    except Patch.DoesNotExist:
        return Response({'error': 'Patch not found or not owned by user.'}, status=404)


# USER VIEWSET — for search by username
class UserViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = User.objects.all().order_by('username')
    serializer_class = UserSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['username']
    lookup_field = 'username'


# USER REGISTRATION ENDPOINT
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


# USER DETAIL BY USERNAME ENDPOINT
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


# Followers of a given username
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


# Following for a given username
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


# NEW: CURRENT USER INFO ENDPOINT (/users/me/)
@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def current_user_view(request):
    serializer = UserSerializer(request.user)
    return Response(serializer.data)


# PROTECTED EXAMPLE VIEW
@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def protected_view(request):
    return Response({'message': f'Hello, {request.user.username}! This is a protected endpoint.'})


# FOLLOW VIEWSET — for follow/unfollow logic
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


# FEED VIEW — shows recent posted patches from followed users (paginated)
@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def feed_view(request):
    user = request.user
    followed_users = Follow.objects.filter(follower=user).values_list('following', flat=True)
    qs = Patch.objects.filter(uploaded_by__in=followed_users, is_posted=True).order_by('-created_at')

    paginator = SmallPageNumberPagination()
    page = paginator.paginate_queryset(qs, request)
    serializer = PatchSerializer(page, many=True, context={'request': request})
    return paginator.get_paginated_response(serializer.data)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def random_posted_patch(request):
    patches = list(Patch.objects.filter(is_posted=True))
    if not patches:
        return Response({'error': 'No posted patches available.'}, status=404)
    patch = random.choice(patches)
    serializer = PatchSerializer(patch)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def lineage_view(request, pk):
    """
    Patch lineage graph payload.
    Layout:
      - Columns (x): fork index (base-32 'x' in 'x.y')
      - Row (y): max(
            baseline depth from root via immediate_predecessor + (sibling_rank-1),
            chronological rank within the fork column
        ), then bumped up if occupied.
      - Edges: immediate_predecessor -> node
    """
    try:
        current_patch = Patch.objects.select_related('uploaded_by', 'root', 'immediate_predecessor').get(pk=pk)
    except Patch.DoesNotExist:
        return Response({'error': 'Patch not found.'}, status=404)

    root = current_patch.root or current_patch

    # Visibility rules
    if request.user.id == current_patch.uploaded_by_id:
        visible_q = Q(root=root)
    else:
        ancestor_ids = set()
        n = current_patch
        while n and n.id not in ancestor_ids:
            ancestor_ids.add(n.id)
            n = n.immediate_predecessor
        visible_q = Q(root=root) & (Q(is_posted=True) | Q(id__in=ancestor_ids))

    patches = (
        Patch.objects.filter(visible_q)
        .select_related('uploaded_by', 'immediate_predecessor')
        .order_by('created_at', 'id')
    )
    if not patches:
        return Response({'nodes': [], 'edges': []})

    def parse_version(ver: str):
        try:
            f_str, e_str = (ver or '0.0').split('.', 1)
            return int(f_str, 32), int(e_str, 32)
        except Exception:
            return 0, 0

    by_id = {p.id: p for p in patches}

    # Build adjacency for BFS depth (pred -> [children])
    children = defaultdict(list)
    for p in patches:
        pred_id = getattr(p.immediate_predecessor, 'id', None)
        if pred_id and pred_id in by_id:
            children[pred_id].append(p.id)

    root_id = root.id

    # 1) Baseline depth via BFS
    depth = {root_id: 0}
    q = deque([root_id])
    while q:
        cur = q.popleft()
        for cid in children.get(cur, []):
            if cid not in depth:
                depth[cid] = depth[cur] + 1
                q.append(cid)

    # 2) Sibling rank per (predecessor, fork column)
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

    # 3) Chronological rank per fork (monotonic upward by creation time)
    chrono_rank = {}
    fork_groups = defaultdict(list)
    for p in patches:
        f_idx, _ = parse_version(p.version)
        fork_groups[f_idx].append(p)
    for f_idx, arr in fork_groups.items():
        arr.sort(key=lambda p: (p.created_at, p.id))
        for i, p in enumerate(arr):
            chrono_rank[p.id] = i

    # 4) Coordinates with column occupancy
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

    # 5) Edges
    edges = []
    for p in patches:
        pred_id = getattr(p.immediate_predecessor, 'id', None)
        if pred_id and pred_id in coords and p.id in coords:
            edges.append({'from': pred_id, 'to': p.id})

    # 6) Nodes payload
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


# === NEW: TRACK LINEAGE VIEW ===
@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def track_lineage_view(request, pk):
    """
    Track lineage graph payload (matches patch layout rules).
    """
    try:
        current_track = Track.objects.select_related('uploaded_by', 'root', 'immediate_predecessor').get(pk=pk)
    except Track.DoesNotExist:
        return Response({'error': 'Track not found.'}, status=404)

    root = current_track.root or current_track

    # Visibility: owner sees all; others see posted + the path to current
    if request.user.id == current_track.uploaded_by_id:
        visible_q = Q(root=root)
    else:
        ancestor_ids = set()
        n = current_track
        while n and n.id not in ancestor_ids:
            ancestor_ids.add(n.id)
            n = n.immediate_predecessor
        visible_q = Q(root=root) & (Q(is_posted=True) | Q(id__in=ancestor_ids))

    tracks = (
        Track.objects.filter(visible_q)
        .select_related('uploaded_by', 'immediate_predecessor')
        .order_by('created_at', 'id')
    )
    if not tracks:
        return Response({'nodes': [], 'edges': []})

    def parse_version(ver: str):
        try:
            f_str, e_str = (ver or '0.0').split('.', 1)
            return int(f_str, 32), int(e_str, 32)
        except Exception:
            return 0, 0

    by_id = {t.id: t for t in tracks}

    # children adjacency for BFS depth
    children = defaultdict(list)
    for t in tracks:
        pred_id = getattr(t.immediate_predecessor, 'id', None)
        if pred_id and pred_id in by_id:
            children[pred_id].append(t.id)

    root_id = root.id

    # 1) BFS depth from root
    depth = {root_id: 0}
    q = deque([root_id])
    while q:
        cur = q.popleft()
        for cid in children.get(cur, []):
            if cid not in depth:
                depth[cid] = depth[cur] + 1
                q.append(cid)

    # 2) Sibling rank per (predecessor, fork column)
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

    # 3) Chronological rank per fork
    chrono_rank = {}
    fork_groups = defaultdict(list)
    for t in tracks:
        f_idx, _ = parse_version(t.version)
        fork_groups[f_idx].append(t)
    for f_idx, arr in fork_groups.items():
        arr.sort(key=lambda t: (t.created_at, t.id))
        for i, t in enumerate(arr):
            chrono_rank[t.id] = i

    # 4) Coordinates with column occupancy (same numbers as patch)
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

    # 5) Edges
    edges = []
    for t in tracks:
        pred_id = getattr(t.immediate_predecessor, 'id', None)
        if pred_id and pred_id in coords and t.id in coords:
            edges.append({'from': pred_id, 'to': t.id})

    # 6) Nodes payload
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
        qs = Track.objects.all().order_by('-created_at')

        if uploaded_by:
            if str(user.id) == uploaded_by:
                qs = qs.filter(uploaded_by__id=uploaded_by)
            else:
                qs = qs.filter(uploaded_by__id=uploaded_by, is_posted=True)
        else:
            qs = qs.filter(is_posted=True)
        return qs

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)

    def get_object(self):
        track = get_object_or_404(Track, pk=self.kwargs['pk'])
        if track.uploaded_by != self.request.user and not track.is_posted:
            self.permission_denied(self.request, message='This track is not publicly available.')
        return track

    @action(detail=True, methods=['post'])
    def post(self, request, pk=None):
        track = self.get_object()
        if track.uploaded_by != request.user:
            return Response({'error': 'Not your track.'}, status=403)
        track.is_posted = True
        track.save(update_fields=['is_posted'])
        return Response({'success': True})

    @action(detail=True, methods=['post'])
    def unpost(self, request, pk=None):
        track = self.get_object()
        if track.uploaded_by != request.user:
            return Response({'error': 'Not your track.'}, status=403)
        track.is_posted = False
        track.save(update_fields=['is_posted'])
        return Response({'success': True})

    # Public posted tracks by username
    @action(detail=False, methods=['get'], url_path=r'posted-by/(?P<username>[^/.]+)')
    def posted_by(self, request, username=None):
        user = get_object_or_404(User, username=username)
        qs = Track.objects.filter(uploaded_by=user, is_posted=True).order_by('-created_at')
        page = self.paginate_queryset(qs)
        if page is not None:
            ser = TrackSerializer(page, many=True, context={'request': request})
            return self.get_paginated_response(ser.data)
        ser = TrackSerializer(qs, many=True, context={'request': request})
        return Response(ser.data)

    # Saved = user's own unposted tracks (private; mirrors patches.saved_by)
    @action(detail=False, methods=['get'], url_path=r'saved-by/(?P<username>[^/.]+)')
    def saved_by(self, request, username=None):
        owner = get_object_or_404(User, username=username)
        if request.user != owner:
            return Response({'detail': 'Forbidden'}, status=403)
        qs = Track.objects.filter(uploaded_by=owner, is_posted=False).order_by('-created_at')
        page = self.paginate_queryset(qs)
        if page is not None:
            ser = TrackSerializer(page, many=True, context={'request': request})
            return self.get_paginated_response(ser.data)
        ser = TrackSerializer(qs, many=True, context={'request': request})
        return Response(ser.data)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def fork_track(request, pk):
    """
    Create a new Track as a fork of pk. Client may optionally pass a mutated items array.
    """
    parent = get_object_or_404(Track, pk=pk)
    data = request.data.copy()
    data['root'] = parent.root_id or parent.id
    data['stem'] = parent.id
    data['immediate_predecessor'] = parent.id
    serializer = TrackSerializer(data=data, context={'request': request})
    serializer.is_valid(raise_exception=True)
    track = serializer.save()
    return Response(TrackSerializer(track, context={'request': request}).data, status=201)
