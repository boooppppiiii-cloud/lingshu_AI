/**
 * 游戏切换区品牌简笔画（线稿风）；金箍使用琥珀色以区别于描边色。
 */

export function FlowerGameLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path d="M16 27.5V18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M12 23.5c-1.6-.9-2.5-2.2-2-3.5.4-1.1 1.8-1 3.2.2M20 23.5c1.6-.9 2.5-2.2 2-3.5-.4-1.1-1.8-1-3.2.2"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      {/* 花冠：圆润五瓣感 */}
      <path
        d="M16 7.5c2.8 0 5 2.2 5 5 0 1.8-.9 3.4-2.3 4.2 1.4.8 2.3 2.4 2.3 4.2 0 2.8-2.2 5-5 5s-5-2.2-5-5c0-1.8.9-3.4 2.3-4.2-1.4-.8-2.3-2.4-2.3-4.2 0-2.8 2.2-5 5-5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="14.5" r="2.2" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}

/** 王牌机甲：简笔机甲头盔 */
export function AceMechaLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M16 4.5 9 9.5v5.5l-2 3v9.5h18v-9.5l-2-3V9.5L16 4.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path d="M11 18h10M13 22h6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <circle cx="12.5" cy="13" r="1.2" fill="#38bdf8" stroke="#0284c7" strokeWidth="0.6" />
      <circle cx="19.5" cy="13" r="1.2" fill="#38bdf8" stroke="#0284c7" strokeWidth="0.6" />
      <path
        d="M16 4.5v3M12 7.5h8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 孙悟空卡通简笔头像 + 金箍 */
export function XiyouWukongLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      {/* 双耳 */}
      <ellipse cx="8.8" cy="15.5" rx="2.1" ry="2.6" stroke="currentColor" strokeWidth="1.25" />
      <ellipse cx="23.2" cy="15.5" rx="2.1" ry="2.6" stroke="currentColor" strokeWidth="1.25" />
      {/* 脸部 */}
      <ellipse cx="16" cy="16.5" rx="6.8" ry="7.5" stroke="currentColor" strokeWidth="1.35" />
      {/* 金箍 */}
      <path
        d="M9.2 11.5c2-1.8 4.8-2.8 6.8-2.8s4.8 1 6.8 2.8c.45.4.7.85.7 1.35 0 .95-.75 1.45-1.7 1.1-1.6-.65-3.4-1-5.5-1s-3.9.35-5.5 1c-.95.35-1.7-.15-1.7-1.1 0-.5.25-.95.7-1.35Z"
        fill="#fbbf24"
        stroke="#b45309"
        strokeWidth="1.05"
        strokeLinejoin="round"
      />
      <circle cx="12.8" cy="16" r="1" fill="currentColor" />
      <circle cx="19.2" cy="16" r="1" fill="currentColor" />
      <path
        d="M13 20.2c1.1 1.1 2.4 1.7 3 1.7s1.9-.6 3-1.7"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  );
}
