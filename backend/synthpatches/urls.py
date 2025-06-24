from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import register, protected_view, PatchViewSet, UserViewSet, FollowViewSet, feed_view

router = DefaultRouter()
router.register(r'patches', PatchViewSet, basename='patch')
router.register(r'users', UserViewSet, basename='user')
router.register(r'follows', FollowViewSet, basename='follow')


urlpatterns = [
    path('register/', register),
    path('protected/', protected_view),
    path('feed/', feed_view),
    path('', include(router.urls)),  # Includes /patches/ and /users/
]
print("Router registry:", router.registry)
