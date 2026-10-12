import CustomCursor from './CustomCursor';

/** The workspace cursor with its approved settings. Mount once at the app root. */
export default function ClaimGuardCursor() {
  return (
    <CustomCursor
      circleSize={35}
      dotSize={9}
      circleColor="rgb(34, 211, 238)"
      dotColor="rgb(34, 211, 238)"
      circleStiffness={80}
      circleDamping={15}
      dotStiffness={320}
      dotDamping={31}
      circleBorderWidth={1}
    />
  );
}
