from rest_framework import viewsets, permissions, filters
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response
from django.contrib.auth.models import User
from .models import Patch, Follow
from .serializers import PatchSerializer, UserSerializer, FollowSerializer

# PATCH API VIEWSET
class PatchViewSet(viewsets.ModelViewSet):
    serializer_class = PatchSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Patch.objects.all().order_by('-created_at')
        uploaded_by = self.request.query_params.get('uploaded_by')
        parent_id = self.request.query_params.get('parent')
        if uploaded_by:
            queryset = queryset.filter(uploaded_by__id=uploaded_by)
        if parent_id:
            queryset = queryset.filter(parent__id=parent_id)
        return queryset

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


# USER VIEWSET — only for search
class UserViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = User.objects.all().order_by('username')
    serializer_class = UserSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['username']


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


# FEED VIEW — shows recent patches from followed users
@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def feed_view(request):
    user = request.user
    followed_users = Follow.objects.filter(follower=user).values_list('following', flat=True)
    recent_patches = Patch.objects.filter(uploaded_by__in=followed_users).order_by('-created_at')
    serializer = PatchSerializer(recent_patches, many=True)
    return Response(serializer.data)
