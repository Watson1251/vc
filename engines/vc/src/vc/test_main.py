import unittest
from unittest.mock import patch, MagicMock
from main import add_reff_voice, add_sound_effect, clone_voice

class TestMainFunctions(unittest.TestCase):

    @patch("main.process_reff_voice")
    @patch("main.move_file_to_db")
    def test_add_reff_voice_success(self, mock_move_file_to_db, mock_process_reff_voice):
        mock_process_reff_voice.return_value = "/data/db/files/STAGING/REFF_VOICE/READY"
        mock_move_file_to_db.return_value = 0

        key = "test_key"
        input_file_path = "/data/db/files/STAGING/REFF_VOICE/ROW/faisal_alqasim.wav"
        config = {"segment_duration": 20}

        result = add_reff_voice(key, input_file_path, config)
        self.assertEqual(result["status"], "success")
        self.assertIn("File moved successfully", result["message"])

    @patch("main.process_reff_voice")
    def test_add_reff_voice_failure(self, mock_process_reff_voice):
        mock_process_reff_voice.return_value = "500"

        key = "test_key"
        input_file_path = "/data/db/files/STAGING/REFF_VOICE/ROW/faisal_alqasim.wav"

        result = add_reff_voice(key, input_file_path)
        self.assertEqual(result["status"], "error")
        self.assertIn("File processing failed", result["message"])

    @patch("main.process_sound_effect_voice")
    @patch("main.move_file_to_db")
    def test_add_sound_effect_success(self, mock_move_file_to_db, mock_process_sound_effect_voice):
        mock_process_sound_effect_voice.return_value = "/data/db/files/STAGING/SOUND_EFFECT/READY"
        mock_move_file_to_db.return_value = 0

        key = "test_key"
        input_file_path = "/data/db/files/STAGING/SOUND_EFFECT/ROW/Muataz_Mishal_sub.wav"

        result = add_sound_effect(key, input_file_path)
        self.assertEqual(result["status"], "success")
        self.assertIn("File moved successfully", result["message"])

    @patch("main.process_sound_effect_voice")
    def test_add_sound_effect_failure(self, mock_process_sound_effect_voice):
        mock_process_sound_effect_voice.return_value = "500"

        key = "test_key"
        input_file_path = "/data/db/files/STAGING/SOUND_EFFECT/ROW/Muataz_Mishal_sub.wav"

        result = add_sound_effect(key, input_file_path)
        self.assertEqual(result["status"], "error")
        self.assertIn("File processing failed", result["message"])

    @patch("main.requests.post")
    @patch("main.os.getenv")
    def test_clone_voice_success(self, mock_getenv, mock_post):
        mock_getenv.return_value = SEED_VC_URL = "http://seedvc-engine/inference:6000"
        mock_post.return_value = MagicMock(status_code=200, json=lambda: {"message": "success"})

        data = {
            "source": "/data/db/files/STAGING/CLONE/ROW/source/faisal_alqasim_sub.wav",
            "target": "/data/db/files/STAGING/CLONE/ROW/target/Yaser_Alhuzaimi.mp3",
            "output": "/data/db/files/STAGING/CLONE/READY",
            "checkpoint": "/data/db/files/DATA/MODELS/my_target/ft_model.pth",
            "diffusion_steps": 25,
            "length_adjust": 1.0,
            "inference_cfg_rate": 0.7
        }

        clone_voice(data)
        mock_post.assert_called_once_with("http://seedvc-engine/inference:6000", json=data)

    @patch("main.requests.post")
    @patch("main.os.getenv")
    def test_clone_voice_failure(self, mock_getenv, mock_post):
        mock_getenv.return_value = "http://seedvc-engine/inference:6000"
        mock_post.return_value = MagicMock(status_code=500, json=lambda: {"error": "failure"})

        data = {
            "source": "/data/db/files/STAGING/CLONE/ROW/source/faisal_alqasim_sub.wav",
            "target": "/data/db/files/STAGING/CLONE/ROW/target/Yaser_Alhuzaimi.mp3",
            "output": "/data/db/files/STAGING/CLONE/READY",
            "checkpoint": "/data/db/files/DATA/MODELS/my_target/ft_model.pth",
            "diffusion_steps": 25,
            "length_adjust": 1.0,
            "inference_cfg_rate": 0.7
        }

        with self.assertLogs(level="ERROR"):
            clone_voice(data)
        mock_post.assert_called_once_with("http://seedvc-engine/inference:6000", json=data)

if __name__ == "__main__":
    unittest.main()