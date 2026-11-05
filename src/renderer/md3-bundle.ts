import '@material/web/button/filled-button.js'
import '@material/web/button/outlined-button.js'
import '@material/web/button/text-button.js'
import '@material/web/button/elevated-button.js'
import '@material/web/switch/switch.js'
import '@material/web/checkbox/checkbox.js'
import '@material/web/textfield/outlined-text-field.js'
import '@material/web/textfield/filled-text-field.js'
import '@material/web/select/outlined-select.js'
import '@material/web/select/select-option.js'
import { MdDialog } from '@material/web/dialog/dialog.js'
import '@material/web/ripple/ripple.js'
import '@material/web/menu/menu.js'
import '@material/web/menu/menu-item.js'
import '@material/web/icon/icon.js'
import '@material/web/chips/chip-set.js'
import '@material/web/chips/assist-chip.js'
import '@material/web/progress/linear-progress.js'
import '@material/web/progress/circular-progress.js'
import { applyMaterialTheme } from './theme.js'

// Fix MdDialog positioning, backdrop, centering, and overflow
const origFirstUpdated = (MdDialog.prototype as any).firstUpdated
;(MdDialog.prototype as any).firstUpdated = function (changedProps: any) {
	if (origFirstUpdated) {
		origFirstUpdated.call(this, changedProps)
	}
	if (this.shadowRoot) {
		try {
			const sheet = new CSSStyleSheet()
			sheet.replaceSync(`
				dialog {
					margin: auto !important;
					inset: 0 !important;
					max-width: min(500px, calc(100vw - 32px)) !important;
					max-height: min(580px, calc(100vh - 48px)) !important;
					border-radius: 28px !important;
					box-shadow: 0 20px 48px rgba(0, 0, 0, 0.7) !important;
					overflow: hidden !important;
				}
				.scrim {
					opacity: 70% !important;
					backdrop-filter: blur(8px) !important;
					-webkit-backdrop-filter: blur(8px) !important;
					background: rgba(0, 0, 0, 0.65) !important;
				}
				.container {
					background: var(--md-sys-color-surface-container-high, #252a28) !important;
					border-radius: 28px !important;
					overflow: hidden !important;
				}
				.container::before {
					background: var(--md-sys-color-surface-container-high, #252a28) !important;
				}
				.scroller {
					overflow-x: hidden !important;
				}
			`)
			this.shadowRoot.adoptedStyleSheets = [...this.shadowRoot.adoptedStyleSheets, sheet]
		} catch (err) {
			console.warn('Could not inject dialog style sheet:', err)
		}
	}
}

// Export globally for renderer scripts
;(window as any).applyMaterialTheme = applyMaterialTheme
