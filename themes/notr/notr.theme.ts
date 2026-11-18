// The notr theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in notr.settings.json and the generated notr.settings.ts;
// change them with `astryx experimental theme editor set notr ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {notrSettings} from './notr.settings';

export const notrTheme = defineTheme({
  extends: notrSettings,
  name: 'notr',
});
