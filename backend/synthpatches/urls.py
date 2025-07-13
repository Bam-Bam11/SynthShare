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
)

router = DefaultRouter()
router.register(r'patches', PatchViewSet, basename='patch')
router.register(r'users', UserViewSet, basename='user')
router.register(r'follows', FollowViewSet, basename='follow')

urlpatterns = [
    path('register/', register),
    path('protected/', protected_view),
    path('users/me/', current_user_view),
    path('users/username/<str:username>/', get_user_by_username),
    path('feed/', feed_view),
    path('patches/<int:pk>/post/', post_patch),
    path('patches/<int:pk>/unpost/', unpost_patch),
    path('', include(router.urls)),
]

print("Router registry:", router.registry)
