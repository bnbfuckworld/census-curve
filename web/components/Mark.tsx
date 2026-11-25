export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 26 H11 V19 H18 V12 H25 V5 H29" />
    </svg>
  );
}
