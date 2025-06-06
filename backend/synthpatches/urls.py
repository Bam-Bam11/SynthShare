from django.urls import path
from .views import register, protected_view

urlpatterns = [
    path('register/', register),
    path('protected/', protected_view),
]
