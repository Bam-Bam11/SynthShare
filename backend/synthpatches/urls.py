from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    register,
    protected_view,
    PatchViewSet,
    UserViewSet,
    FollowViewSet,
    feed_view,
    get_user_by_username,
    current_user_view,
    post_patch,
    unpost_patch,
    random_posted_patch,
    lineage_view,
    followers_of_user,
    following_of_user,
    TrackViewSet, 
    fork_track, 
    track_lineage_view, 
    DirectMessageViewSet,
)

router = DefaultRouter()
router.register(r'patches', PatchViewSet, basename='patch')
router.register(r'users', UserViewSet, basename='user')
router.register(r'follows', FollowViewSet, basename='follow')
router.register(r'tracks', TrackViewSet, basename='track')
router.register(r'messages', DirectMessageViewSet, basename='message') 


urlpatterns = [
    path('register/', register),
    path('protected/', protected_view),
    path('users/me/', current_user_view),
    path('users/username/<str:username>/', get_user_by_username),
    path('users/username/<str:username>/followers/', followers_of_user),
    path('users/username/<str:username>/following/', following_of_user),
    path('feed/', feed_view),
    path('patches/<int:pk>/post/', post_patch),
    path('patches/<int:pk>/unpost/', unpost_patch),
    path('patches/random/', random_posted_patch),
    path('patches/<int:pk>/lineage/', lineage_view),
    path('tracks/<int:pk>/lineage/', track_lineage_view), 
    path('', include(router.urls)),
    path('tracks/<int:pk>/fork/', fork_track),
]

print("Router registry:", router.registry)