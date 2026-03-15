from django.test import SimpleTestCase

from .views import build_generation_prompt, should_treat_as_new_request


class PromptBuilderTests(SimpleTestCase):
	def test_short_follow_up_keeps_existing_html_context(self):
		previous_html = '<html><body><main class="calculator">Calculator</main></body></html>'

		prompt = build_generation_prompt('black', previous_html=previous_html)

		self.assertIn('Modify the existing website/app below.', prompt)
		self.assertIn('Instruction: black', prompt)
		self.assertIn('Existing HTML:', prompt)
		self.assertIn(previous_html, prompt)

	def test_follow_up_theme_change_is_not_treated_as_new_project(self):
		self.assertFalse(should_treat_as_new_request('make the calculator black theme'))

	def test_explicit_new_request_creates_new_project_prompt(self):
		previous_html = '<html><body><main class="calculator">Calculator</main></body></html>'

		prompt = build_generation_prompt('create a new portfolio website', previous_html=previous_html)

		self.assertTrue(should_treat_as_new_request('create a new portfolio website'))
		self.assertIn('Create a complete website/app that satisfies the user instruction.', prompt)
		self.assertNotIn('Existing HTML:', prompt)
		self.assertNotIn(previous_html, prompt)

	def test_image_description_is_attached_to_edit_prompt(self):
		previous_html = '<html><body><main class="calculator">Calculator</main></body></html>'
		image_description = 'Dark glassmorphism calculator with neon blue accents.'

		prompt = build_generation_prompt('make it match this reference', previous_html=previous_html, image_description=image_description)

		self.assertIn('Reference UI Description:', prompt)
		self.assertIn(image_description, prompt)
