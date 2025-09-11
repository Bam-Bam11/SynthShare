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


# PATCH API VIEWSET
class PatchViewSet(viewsets.ModelViewSet):
    serializer_class = PatchSerializer
    permission_classes = [permissions.IsAuthenticated]
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
        patch = serializer.save(uploaded_by=self.request.user)
        patch.save()

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
@permission_classes([permissions.IsAuthenticated])
def lineage_view(request, pk):
    try:
        current_patch = Patch.objects.get(pk=pk)
    except Patch.DoesNotExist:
        return Response({'error': 'Patch not found.'}, status=404)

    root = current_patch.root or current_patch
    all_patches = Patch.objects.filter(root=root, is_posted=True).order_by('created_at')

    # Build patch node data
    node_map = {}
    for patch in all_patches:
        node_map[patch.id] = {
            'id': patch.id,
            'name': patch.name,
            'version': patch.version,
            'downloads': patch.downloads,
            'is_posted': patch.is_posted,
            'isCurrent': (patch.id == current_patch.id),
            'uploaded_by': patch.uploaded_by.username,
            'stem': patch.stem.id if patch.stem else None,
            'immediate_predecessor': patch.immediate_predecessor.id if patch.immediate_predecessor else None,
            'x': 0,
            'y': 0,
        }

    # Build edges
    edges = []
    for node in node_map.values():
        if node['immediate_predecessor']:
            edges.append({'from': node['immediate_predecessor'], 'to': node['id']})

    # Layout logic: vertical edit stack, forks branch right
    X0 = 100  # root x
    Y0 = 100  # root y
    C = 120   # vertical spacing (edits)
    D = 160   # horizontal spacing (forks)

    column_map = {}  # uploaded_by_id -> fork column index
    column_map[root.uploaded_by.id] = 0  # root user starts in column 0

    node_map[root.id]['x'] = X0
    node_map[root.id]['y'] = Y0

    fork_depth = {0: 0}  # depth per column

    for patch in all_patches:
        if patch.id == root.id:
            continue

        node = node_map[patch.id]

        is_edit = (
            patch.stem and
            patch.stem.uploaded_by_id == patch.uploaded_by_id
        )

        if is_edit:
            col = column_map[patch.uploaded_by.id]
        else:
            if patch.uploaded_by.id not in column_map:
                col = len(column_map)
                column_map[patch.uploaded_by.id] = col
                fork_depth[col] = 0
            else:
                col = column_map[patch.uploaded_by.id]

        x = X0 + col * D
        y = Y0 - (fork_depth[col] + 1) * C
        fork_depth[col] += 1

        node['x'] = x
        node['y'] = y

    return Response({
        'nodes': list(node_map.values()),
        'edges': edges,
    })

class TrackViewSet(viewsets.ModelViewSet):
    serializer_class = TrackSerializer
    permission_classes = [permissions.IsAuthenticated]
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
    return Response(TrackSerializer(track).data, status=201)