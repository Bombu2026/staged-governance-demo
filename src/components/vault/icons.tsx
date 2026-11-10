import type { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconClose = () => (
  <Icon>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

export const IconBack = () => (
  <Icon>
    <path d="M10 3.5L5.5 8l4.5 4.5" />
  </Icon>
);

export const IconForward = () => (
  <Icon>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Icon>
);

export const IconChevron = ({ open }: { open: boolean }) => (
  <Icon className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>
    <path d="M6 4l4 4-4 4" />
  </Icon>
);

export const IconExternal = () => (
  <Icon width="14" height="14">
    <path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" />
  </Icon>
);

export const IconVault = () => (
  <Icon width="18" height="18">
    <path d="M3 2.5h7.5L13 5v8.5H3z" />
    <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" />
  </Icon>
);
