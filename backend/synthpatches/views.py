from rest_framework import viewsets, permissions, filters
from rest_framework.generics import get_object_or_404
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response
from django.contrib.auth.models import User
from rest_framework.exceptions import PermissionDenied
from .models import Patch, Follow
from .serializers import PatchSerializer, UserSerializer, FollowSerializer

# PATCH API VIEWSET
class PatchViewSet(viewsets.ModelViewSet):
    serializer_class = PatchSerializer
    permission_classes = [permissions.IsAuthenticated]

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
            raise PermissionDenied("This patch is not publicly available.")

        return patch

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
def get_user_by_username(request, username):
    try:
        user = User.objects.get(username=username)
        serializer = UserSerializer(user)
        return Response(serializer.data)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=404)


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


# FEED VIEW — shows recent patches from followed users
@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def feed_view(request):
    user = request.user
    followed_users = Follow.objects.filter(follower=user).values_list('following', flat=True)
    recent_patches = Patch.objects.filter(uploaded_by__in=followed_users).order_by('-created_at')
    serializer = PatchSerializer(recent_patches, many=True)
    return Response(serializer.data)

