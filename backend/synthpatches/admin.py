from django.contrib import admin
from .models import Patch, Follow  


class PatchAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'uploaded_by', 'created_at')


admin.site.register(Patch, PatchAdmin)
admin.site.register(Follow)
