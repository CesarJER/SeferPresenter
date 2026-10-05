import importlib.util
import json
from pathlib import Path
import random
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("optimize_assets", Path(__file__).resolve().parents[1] / "scripts" / "optimize_assets.py")
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class AssetOptimizerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="sefer-optimizer-test-")
        self.root = Path(self.temporary.name)
        self.public = self.root / "public"
        self.public.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def video(self, size=20 * 1024 * 1024):
        file = self.public / "video.mp4"
        with file.open("wb") as stream:
            stream.truncate(size)
        return file

    def fake_encode(self, output_size):
        def run(args, **_kwargs):
            if args[-1] == "-encoders":
                return subprocess.CompletedProcess(args, 0, stdout="libx264")
            with Path(args[-1]).open("wb") as output:
                output.truncate(output_size)
            return subprocess.CompletedProcess(args, 0)
        return run

    def optimizer(self, **options):
        optimizer = assets.AssetOptimizer(str(self.root), **options)
        optimizer.ffmpeg = self.root / "fake-ffmpeg"
        optimizer.ffmpeg.write_bytes(b"fixture")
        return optimizer

    def test_preview_does_not_change_files_or_run_encoder(self):
        self.video()
        images = self.public / "backgrounds"
        images.mkdir()
        (images / "preview.png").write_bytes(b"preview fixture")
        before = sorted(path.relative_to(self.root).as_posix() for path in self.root.rglob("*"))
        with mock.patch.object(assets.subprocess, "run") as encoder:
            self.assertEqual(assets.main(["--data-dir", str(self.root), "--dry-run"]), 0)
            encoder.assert_not_called()
        self.assertEqual(before, sorted(path.relative_to(self.root).as_posix() for path in self.root.rglob("*")))

    def test_index_skips_without_legacy_and_reoptimizes_changed_content(self):
        video = self.video()
        optimizer = self.optimizer()
        with mock.patch.object(assets.subprocess, "run", side_effect=self.fake_encode(16 * 1024 * 1024)):
            optimizer.optimize_videos()
        entry = json.loads(optimizer.index_file.read_text())["files"]["/video.mp4"]
        self.assertEqual(entry["sha256"], assets.digest(video))
        legacy = self.root / "legacy"
        self.assertTrue(legacy.resolve().is_relative_to(self.root.resolve()))
        shutil.rmtree(legacy)
        with mock.patch.object(assets.subprocess, "run") as encoder:
            self.optimizer().optimize_videos()
            encoder.assert_not_called()
        with video.open("r+b") as stream:
            stream.write(b"changed content")
        with mock.patch.object(assets.subprocess, "run", side_effect=self.fake_encode(8 * 1024 * 1024)) as encoder:
            self.optimizer(backup=False).optimize_videos()
            self.assertGreater(encoder.call_count, 0)
        self.assertFalse(legacy.exists())

    def test_no_reduction_is_recorded_without_replacing_original(self):
        video = self.video()
        before = assets.digest(video)
        optimizer = self.optimizer(backup=False)
        with mock.patch.object(assets.subprocess, "run", side_effect=self.fake_encode(21 * 1024 * 1024)):
            optimizer.optimize_videos()
        self.assertEqual(assets.digest(video), before)
        with mock.patch.object(assets.subprocess, "run") as encoder:
            self.optimizer().optimize_videos()
            encoder.assert_not_called()

    def test_failed_index_persistence_does_not_replace_video(self):
        video = self.video()
        before = assets.digest(video)
        optimizer = self.optimizer(backup=False)
        with mock.patch.object(assets.subprocess, "run", side_effect=self.fake_encode(8 * 1024 * 1024)):
            with mock.patch.object(assets, "write_json", side_effect=OSError("synthetic disk failure")):
                optimizer.optimize_videos()
        self.assertEqual(optimizer.errors, 1)
        self.assertEqual(assets.digest(video), before)
        self.assertFalse(optimizer.index_file.exists())

    def test_invalid_index_fails_closed(self):
        video = self.video()
        before = assets.digest(video)
        (self.root / "asset-optimization.txt").write_text("invalid", encoding="utf-8")
        with mock.patch.object(assets.subprocess, "run") as encoder:
            self.assertEqual(assets.main(["--data-dir", str(self.root)]), 1)
            encoder.assert_not_called()
        self.assertEqual(assets.digest(video), before)

    def test_image_catalog_failure_keeps_png_and_retry_reuses_indexed_webp(self):
        from PIL import Image
        images = self.public / "backgrounds"
        images.mkdir()
        source = images / "synthetic.png"
        Image.frombytes("RGB", (64, 64), random.Random(42).randbytes(64 * 64 * 3)).save(source)
        catalog = self.root / "presentations.json"
        catalog.write_text("invalid", encoding="utf-8")
        optimizer = self.optimizer(backup=False)
        renamed = optimizer.optimize_images()
        self.assertEqual(renamed, {"/backgrounds/synthetic.png": "/backgrounds/synthetic.webp"})
        self.assertFalse(optimizer.update_presentations(renamed))
        self.assertTrue(source.exists())
        catalog.write_text(json.dumps([{ "background": "/backgrounds/synthetic.png" }]), encoding="utf-8")
        recovered = self.optimizer(backup=False)
        with mock.patch.object(Image, "open", side_effect=AssertionError("Should not encode twice")):
            renamed = recovered.optimize_images()
        self.assertTrue(recovered.update_presentations(renamed))
        self.assertFalse(source.exists())
        self.assertEqual(json.loads(catalog.read_text())[0]["background"], "/backgrounds/synthetic.webp")
        self.assertFalse((self.root / "legacy").exists())


if __name__ == "__main__":
    unittest.main()
