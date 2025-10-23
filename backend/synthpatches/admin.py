from django.contrib import admin
from .models import Patch, Follow, Track

class TrackAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'uploaded_by', 'bpm', 'is_posted', 'created_at', 'composition_count')
    search_fields = ('name', 'uploaded_by__username')
    list_filter = ('is_posted', 'bpm', 'created_at')

    def composition_count(self, obj):
        try:
            return len(obj.composition.get('items', []))
        except Exception:
            return 0
    composition_count.short_description = 'Items'

class PatchAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'uploaded_by', 'created_at')

admin.site.register(Track, TrackAdmin)
admin.site.register(Patch, PatchAdmin)
admin.site.register(Follow)
