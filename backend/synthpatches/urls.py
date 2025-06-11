from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import register, protected_view, PatchViewSet

router = DefaultRouter()
router.register(r'patches', PatchViewSet, basename='patch')

urlpatterns = [
    path('register/', register),
    path('protected/', protected_view),
    path('', include(router.urls)),  # Include all routes from the router
]
