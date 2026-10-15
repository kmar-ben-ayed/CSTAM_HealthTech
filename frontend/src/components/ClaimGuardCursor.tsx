import CustomCursor from './CustomCursor';

/** The workspace cursor with its approved settings. Mount once at the app root. */
export default function ClaimGuardCursor() {
  return (
    <CustomCursor
      circleSize={35}
      dotSize={9}
      circleColor="rgb(34, 211, 238)"
      dotColor="rgb(34, 211, 238)"
      circleStiffness={1000}
      circleDamping={64}
      circleBorderWidth={1}
    />
  );
}
