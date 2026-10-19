// Test IDs for the auth feature (login, register, logout) — consumed via
// React Native's `testID` prop on TouchableOpacity / Pressable / TextInput /
// Button / Switch and friends. Add new keys here as you wire up additional
// auth UI; see ./index.js for the recipe to add a new feature file.
//
// React Native uses `testID` (camelCase, no dash), not `data-testid`:
//   import { LOGIN } from '../constants/testIds';
//   <TouchableOpacity testID={LOGIN.submitButton} onPress={...} />
//   <TextInput testID={LOGIN.emailInput} ... />
//
// Directive:
//   - Keys are camelCase, values are kebab-case shaped as `<feature>-<element>`
//     (or `<feature>-<element>-<qualifier>` when an element repeats). Examples:
//     'login-submit-button', 'cart-quantity-input', 'product-card-image'.
//
// Why kebab-case values: they work as CSS-attribute-style selectors for
// browser-driven E2E tooling (Playwright: [data-testid="login-submit-button"],
// which react-native-web emits from `testID` on web).

// Auth is passwordless: one screen covers both sign-in and sign-up, because
// entering a code either finds the account or creates it. There is no separate
// REGISTER surface and no password field anywhere.
export const LOGIN = {
	emailInput: 'login-email-input',
	submitButton: 'login-submit-button',
	googleButton: 'login-google-button',
	guestLink: 'login-guest-link',
	// Second stage, after a code has been sent.
	codeInput: 'login-code-input',
	verifyButton: 'login-verify-button',
	resendLink: 'login-resend-link',
	changeEmailLink: 'login-change-email-link',
};

export const LOGOUT = {
	button: 'logout-button',
};
