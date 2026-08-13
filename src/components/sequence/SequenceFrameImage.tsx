import Image from "next/image";
import { sequenceAssetFocalX, sequenceFocalMediaStyle } from "@/utils/sequenceFraming";

export default function SequenceFrameImage({
  src,
  priority = false,
  className,
}: {
  src: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={src}
      alt=""
      width={1920}
      height={1080}
      sizes="107vw"
      priority={priority}
      unoptimized
      draggable={false}
      aria-hidden="true"
      className={className}
      style={sequenceFocalMediaStyle(sequenceAssetFocalX(src))}
    />
  );
}
