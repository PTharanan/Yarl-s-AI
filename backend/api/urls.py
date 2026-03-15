from django.urls import path
from .views import GenerateView, StopGenerationView, ListModelsView

urlpatterns = [
    path('generate/', GenerateView.as_view(), name='generate'),
    path('stop/', StopGenerationView.as_view(), name='stop'),
    path('models/', ListModelsView.as_view(), name='list_models'),
]
