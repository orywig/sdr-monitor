from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from sdr.models import Group, Transmission


class TransmissionsFeedTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_superuser("admin", "admin@example.com", "password")
        self.client.force_login(user)
        self.url = reverse("sdr_transmissions_feed")
        self.fm = Group.objects.create(name="FM band", modulation="FM", begin_frequency=88000000, end_frequency=108000000)
        self.raw = Group.objects.create(name="Raw band", modulation="RAW", begin_frequency=400000000, end_frequency=400100000)

    def _make(self, group, ended_seconds_ago, freq=100000000, source="scanner"):
        end = timezone.now() - timezone.timedelta(seconds=ended_seconds_ago)
        return Transmission.objects.create(
            begin_frequency=freq - 6000,
            end_frequency=freq + 6000,
            begin_date=end - timezone.timedelta(seconds=3),
            end_date=end,
            sample_size=12000,
            data_file="transmission/test.bin",
            data_type="uint8",
            group=group,
            source=source,
        )

    def _ids(self, response):
        self.assertEqual(response.status_code, 200)
        return [t["id"] for t in response.json()["transmissions"]]

    def test_completed_audio_included(self):
        transmission = self._make(self.fm, ended_seconds_ago=10)
        self.assertIn(transmission.id, self._ids(self.client.get(self.url)))

    def test_in_progress_excluded(self):
        # still receiving chunks: end_date is within the completion guard window
        transmission = self._make(self.fm, ended_seconds_ago=0)
        self.assertNotIn(transmission.id, self._ids(self.client.get(self.url)))

    def test_non_audio_group_excluded(self):
        transmission = self._make(self.raw, ended_seconds_ago=10)
        self.assertNotIn(transmission.id, self._ids(self.client.get(self.url)))

    def test_after_cursor_returns_only_newer(self):
        older = self._make(self.fm, ended_seconds_ago=20)
        newer = self._make(self.fm, ended_seconds_ago=10)
        self.assertEqual(self._ids(self.client.get(self.url, {"after": older.id})), [newer.id])

    def test_payload_fields(self):
        transmission = self._make(self.fm, ended_seconds_ago=10)
        item = self.client.get(self.url).json()["transmissions"][0]
        self.assertEqual(item["id"], transmission.id)
        self.assertEqual(item["modulation"], "FM")
        self.assertTrue(item["data_url"].endswith("/data/"))

    def test_requires_login(self):
        self.client.logout()
        self.assertIn(self.client.get(self.url).status_code, (302, 403))
