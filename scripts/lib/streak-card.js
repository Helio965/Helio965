// Replica of the GitHub Readme Streak Stats card (github-readme-streak-stats,
// MIT) as the profile used it: locale pt_BR, hide_border=true, default theme
// in light mode and github-dark-blue in dark mode. Same geometry, fonts,
// animations, ring and fire icon; the numbers come from the project activity.
const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR');
const DAY_FORMAT = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const FONT = `font-family='"Segoe UI", Ubuntu, sans-serif'`;
// Card width / 3 columns / average glyph width, as in the original card.
const MAX_LABEL_CHARS = 22;
const MAX_DATE_CHARS = 27;
// Blank lines of the original template keep their indentation.
const PAD = ' '.repeat(12);

export const STREAK_THEMES = {
  light: {
    background: '#FFFEFE', stroke: '#E4E2E2', ring: '#FB8C00', fire: '#FB8C00', currStreakNum: '#151515',
    sideNums: '#151515', currStreakLabel: '#FB8C00', sideLabels: '#151515', dates: '#464646'
  },
  dark: {
    background: '#0D1117', stroke: '#E4E2E2', ring: '#1F6FEB', fire: '#58A6FF', currStreakNum: '#FEFEFE',
    sideNums: '#58A6FF', currStreakLabel: '#FEFEFE', sideLabels: '#FEFEFE', dates: '#9E9E9E'
  }
};

export const STREAK_LABELS = {
  total: 'Total de Commits',
  current: 'Dias Consecutivos',
  longest: 'Maior Sequência',
  present: 'Presente'
};

export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

// "30 de out." within the current year, "26 de abr. de 2022" otherwise.
export function formatDay(day, currentYear) {
  const date = new Date(day + 'T12:00:00Z');
  return (day.slice(0, 4) === String(currentYear) ? DAY_FORMAT : DAY_YEAR_FORMAT).format(date);
}

export function formatRange(start, end, currentYear) {
  const first = formatDay(start, currentYear);
  const last = formatDay(end, currentYear);
  return first === last ? first : first + ' - ' + last;
}

// Long texts go on two <tspan> lines, preferably split at " - ".
export function splitLines(text, maxChars, firstLineOffset) {
  let value = text;
  if (Array.from(value).length > maxChars && !value.includes('\n')) {
    if (value.includes(' - ')) {
      value = value.replace(' - ', '\n- ');
    } else {
      const words = value.split(' ');
      let line = '';
      const lines = [];
      for (const word of words) {
        if (line && Array.from(line + ' ' + word).length > maxChars) {
          lines.push(line);
          line = word;
        } else {
          line = line ? line + ' ' + word : word;
        }
      }
      lines.push(line);
      value = lines.join('\n');
    }
  }
  const [first, ...rest] = escapeXml(value).split('\n');
  return rest.length
    ? `<tspan x='0' dy='${firstLineOffset}'>${first}</tspan><tspan x='0' dy='16'>${rest.join(' ')}</tspan>`
    : first;
}

const text = (fill, weight, size, style, content, y = 32) =>
  `<text x='0' y='${y}' stroke-width='0' text-anchor='middle' fill='${fill}' stroke='none' ${FONT} font-weight='${weight}' font-size='${size}' font-style='normal' style='${style}'>
                        ${content}
                    </text>`;

export function renderStreakCard({ total, firstDay, current, longest, today }, themeName = 'light', labels = STREAK_LABELS) {
  const theme = STREAK_THEMES[themeName];
  if (!theme) throw new RangeError('Unknown theme: ' + themeName);
  for (const [name, value] of [['total', total], ['current', current?.length], ['longest', longest?.length]]) {
    if (!Number.isInteger(value) || value < 0) throw new RangeError('Invalid ' + name + ': ' + value);
  }
  const year = today.slice(0, 4);
  // With no active streak the original card shows today's date.
  const currentRange = current.length ? formatRange(current.start, current.end, year) : formatDay(today, year);
  const longestRange = longest.length ? formatRange(longest.start, longest.end, year) : formatDay(today, year);
  const totalRange = (firstDay ? formatDay(firstDay, year) : formatDay(today, year)) + ' - ' + labels.present;
  const fade = delay => 'opacity: 0; animation: fadein 0.5s linear forwards ' + delay + 's';

  return `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'
                style='isolation: isolate' viewBox='0 0 495 195' width='495px' height='195px' direction='ltr'>
        <style>
            @keyframes currstreak {
                0% { font-size: 3px; opacity: 0.2; }
                80% { font-size: 34px; opacity: 1; }
                100% { font-size: 28px; opacity: 1; }
            }
            @keyframes fadein {
                0% { opacity: 0; }
                100% { opacity: 1; }
            }
        </style>
        <defs>
            <clipPath id='outer_rectangle'>
                <rect width='495' height='195' rx='4.5'/>
            </clipPath>
            <mask id='mask_out_ring_behind_fire'>
                <rect width='495' height='195' fill='white'/>
                <ellipse id='mask-ellipse' cx='247.5' cy='32' rx='13' ry='18' fill='black'/>
            </mask>
${PAD}
        </defs>
        <g clip-path='url(#outer_rectangle)'>
            <g style='isolation: isolate'>
                <rect stroke='#000000' stroke-opacity='0' fill='${theme.background}' rx='4.5' x='0.5' y='0.5' width='494' height='194'/>
            </g>
            <g style='isolation: isolate'>
                <line x1='165' y1='28' x2='165' y2='170' vector-effect='non-scaling-stroke' stroke-width='1' stroke='${theme.stroke}' stroke-linejoin='miter' stroke-linecap='square' stroke-miterlimit='3'/>
                <line x1='330' y1='28' x2='330' y2='170' vector-effect='non-scaling-stroke' stroke-width='1' stroke='${theme.stroke}' stroke-linejoin='miter' stroke-linecap='square' stroke-miterlimit='3'/>
            </g>
            <g style='isolation: isolate'>
                <!-- Total Contributions big number -->
                <g transform='translate(82.5, 48)'>
                    ${text(theme.sideNums, 700, '28px', fade(0.6), NUMBER_FORMAT.format(total))}
                </g>

                <!-- Total Contributions label -->
                <g transform='translate(82.5, 84)'>
                    ${text(theme.sideLabels, 400, '14px', fade(0.7), splitLines(labels.total, MAX_LABEL_CHARS, -9))}
                </g>

                <!-- Total Contributions range -->
                <g transform='translate(82.5, 114)'>
                    ${text(theme.dates, 400, '12px', fade(0.8), splitLines(totalRange, MAX_DATE_CHARS, 0))}
                </g>
            </g>
            <g style='isolation: isolate'>
                <!-- Current Streak label -->
                <g transform='translate(247.5, 108)'>
                    ${text(theme.currStreakLabel, 700, '14px', fade(0.9), splitLines(labels.current, MAX_LABEL_CHARS, -9))}
                </g>

                <!-- Current Streak range -->
                <g transform='translate(247.5, 145)'>
                    ${text(theme.dates, 400, '12px', fade(0.9), splitLines(currentRange, MAX_DATE_CHARS, 0), 21)}
                </g>

                <!-- Ring around number -->
                <g mask='url(#mask_out_ring_behind_fire)'>
                    <circle cx='247.5' cy='71' r='40' fill='none' stroke='${theme.ring}' stroke-width='5' style='${fade(0.4)}'></circle>
                </g>
                <!-- Fire icon -->
                <g transform='translate(247.5, 19.5)' stroke-opacity='0' style='${fade(0.6)}'>
                    <path d='M -12 -0.5 L 15 -0.5 L 15 23.5 L -12 23.5 L -12 -0.5 Z' fill='none'/>
                    <path d='M 1.5 0.67 C 1.5 0.67 2.24 3.32 2.24 5.47 C 2.24 7.53 0.89 9.2 -1.17 9.2 C -3.23 9.2 -4.79 7.53 -4.79 5.47 L -4.76 5.11 C -6.78 7.51 -8 10.62 -8 13.99 C -8 18.41 -4.42 22 0 22 C 4.42 22 8 18.41 8 13.99 C 8 8.6 5.41 3.79 1.5 0.67 Z M -0.29 19 C -2.07 19 -3.51 17.6 -3.51 15.86 C -3.51 14.24 -2.46 13.1 -0.7 12.74 C 1.07 12.38 2.9 11.53 3.92 10.16 C 4.31 11.45 4.51 12.81 4.51 14.2 C 4.51 16.85 2.36 19 -0.29 19 Z' fill='${theme.fire}' stroke-opacity='0'/>
                </g>

                <!-- Current Streak big number -->
                <g transform='translate(247.5, 48)'>
                    ${text(theme.currStreakNum, 700, '28px', 'animation: currstreak 0.6s linear forwards', NUMBER_FORMAT.format(current.length))}
                </g>

            </g>
            <g style='isolation: isolate'>
                <!-- Longest Streak big number -->
                <g transform='translate(412.5, 48)'>
                    ${text(theme.sideNums, 700, '28px', fade(1.2), NUMBER_FORMAT.format(longest.length))}
                </g>

                <!-- Longest Streak label -->
                <g transform='translate(412.5, 84)'>
                    ${text(theme.sideLabels, 400, '14px', fade(1.3), splitLines(labels.longest, MAX_LABEL_CHARS, -9))}
                </g>

                <!-- Longest Streak range -->
                <g transform='translate(412.5, 114)'>
                    ${text(theme.dates, 400, '12px', fade(1.4), splitLines(longestRange, MAX_DATE_CHARS, 0))}
                </g>
            </g>
${PAD}
        </g>
    </svg>
`;
}
