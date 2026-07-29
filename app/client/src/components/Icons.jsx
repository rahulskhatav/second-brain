/* Phosphor icons, inline — the same paths the prototype uses. */

const box = (size) => ({ width: size, height: size, viewBox: '0 0 256 256', display: 'block' });

export const LinkIcon = ({ size = 15, color = 'rgba(233,233,237,.45)', width = 18 }) => (
  <svg {...box(size)} fill="none" stroke={color} strokeWidth={width} style={{ flex: 'none' }}>
    <path d="M137.5 74.5l24-24a44 44 0 0162 62l-32 32a44 44 0 01-62 0" />
    <path d="M118.5 181.5l-24 24a44 44 0 01-62-62l32-32a44 44 0 0162 0" />
  </svg>
);

export const SearchIcon = ({ size = 14, color = 'rgba(233,233,237,.45)' }) => (
  <svg {...box(size)} fill="none" stroke={color} strokeWidth="20" style={{ flex: 'none' }}>
    <circle cx="112" cy="112" r="80" />
    <path d="M168 168l60 60" />
  </svg>
);

export const PlusIcon = ({ size = 14 }) => (
  <svg {...box(size)} fill="currentColor">
    <path d="M224 128a8 8 0 01-8 8h-80v80a8 8 0 01-16 0v-80H40a8 8 0 010-16h80V40a8 8 0 0116 0v80h80a8 8 0 018 8z" />
  </svg>
);

export const MinusIcon = ({ size = 14 }) => (
  <svg {...box(size)} fill="currentColor">
    <path d="M224 128a8 8 0 01-8 8H40a8 8 0 010-16h176a8 8 0 018 8z" />
  </svg>
);

export const CrosshairIcon = ({ size = 15 }) => (
  <svg {...box(size)} fill="none" stroke="currentColor" strokeWidth="18">
    <circle cx="128" cy="128" r="34" />
    <circle cx="128" cy="128" r="88" />
    <path d="M128 24v22M128 210v22M24 128h22M210 128h22" />
  </svg>
);

export const CloseIcon = ({ size = 13 }) => (
  <svg {...box(size)} fill="currentColor">
    <path d="M205.7 194.3a8 8 0 01-11.4 11.4L128 139.3l-66.3 66.4a8 8 0 01-11.4-11.4l66.4-66.3-66.4-66.3a8 8 0 0111.4-11.4l66.3 66.4 66.3-66.4a8 8 0 0111.4 11.4L139.3 128z" />
  </svg>
);

export const OpenIcon = ({ size = 11 }) => (
  <svg {...box(size)} fill="currentColor" style={{ flex: 'none' }}>
    <path d="M216 40v72a8 8 0 01-16 0V59.3l-90.3 90.4a8 8 0 01-11.4-11.4L188.7 48H136a8 8 0 010-16h72a8 8 0 018 8zm-32 88a8 8 0 00-8 8v72H48V80h72a8 8 0 000-16H48a16 16 0 00-16 16v128a16 16 0 0016 16h128a16 16 0 0016-16v-72a8 8 0 00-8-8z" />
  </svg>
);

export const CheckIcon = ({ size = 16, color = '#9184d9' }) => (
  <svg {...box(size)} fill={color} style={{ marginTop: 1, flex: 'none' }}>
    <path d="M128 24a104 104 0 10104 104A104 104 0 00128 24zm45.7 85.7l-56 56a8 8 0 01-11.4 0l-24-24a8 8 0 0111.4-11.4L112 148.7l50.3-50.4a8 8 0 0111.4 11.4z" />
  </svg>
);

export const InfoIcon = ({ size = 15, color = '#b5abfc', style }) => (
  <svg {...box(size)} fill={color} style={{ flex: 'none', ...style }}>
    <path d="M128 24a104 104 0 10104 104A104 104 0 00128 24zm0 176a12 12 0 1112-12 12 12 0 01-12 12zm8-48a8 8 0 01-16 0V80a8 8 0 0116 0z" />
  </svg>
);
