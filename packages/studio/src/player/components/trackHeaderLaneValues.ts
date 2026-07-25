/**
 * Sampling and formatting for the property-lane readouts in the track header:
 * what value a property holds at a given tween percentage, and how that value
 * reads to a human. Kept apart from the header's JSX so a formatting change and
 * a layout change never touch the same file.
 */
import {
  classifyPropertyGroup,
  type GsapAnimation,
  type PropertyGroupName,
} from "@hyperframes/core/gsap-parser";

export type LaneValues = Record<string, number | string>;

function roundValue(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function propertyValueAt(
  animation: GsapAnimation,
  property: string,
  tweenPercentage: number,
): number | string | undefined {
  const keyframes = animation.keyframes?.keyframes ?? [];
  const values = keyframes
    .filter((keyframe) => property in keyframe.properties)
    .map((keyframe) => ({
      percentage: keyframe.percentage,
      value: keyframe.properties[property],
    }));
  const before = values.filter((value) => value.percentage <= tweenPercentage).at(-1);
  const after = values.find((value) => value.percentage >= tweenPercentage);
  if (!before) return after?.value;
  if (!after) return before.value;
  if (
    typeof before.value !== "number" ||
    typeof after.value !== "number" ||
    before.percentage === after.percentage
  ) {
    return before.value;
  }
  const progress = (tweenPercentage - before.percentage) / (after.percentage - before.percentage);
  return before.value + (after.value - before.value) * progress;
}

/** Every property of `group` this animation touches, sampled at `tweenPercentage`. */
export function valuesAt(
  animation: GsapAnimation,
  group: PropertyGroupName,
  tweenPercentage: number,
): LaneValues {
  const propertyNames = new Set<string>();
  for (const keyframe of animation.keyframes?.keyframes ?? []) {
    for (const property of Object.keys(keyframe.properties)) {
      if (classifyPropertyGroup(property) === group) propertyNames.add(property);
    }
  }
  const values: LaneValues = {};
  for (const property of propertyNames) {
    const value = propertyValueAt(animation, property, tweenPercentage);
    if (value !== undefined) values[property] = value;
  }
  return values;
}

export function groupLabel(group: PropertyGroupName, properties: LaneValues): string {
  if (group === "visual" && ("opacity" in properties || "autoAlpha" in properties)) {
    return "Opacity";
  }
  if (group !== "other") return `${group[0]?.toUpperCase() ?? ""}${group.slice(1)}`;
  const property = Object.keys(properties)[0];
  return property ? `${property[0]?.toUpperCase() ?? ""}${property.slice(1)}` : "Other";
}

function defaultValueReadout(values: LaneValues): string {
  return Object.values(values)
    .map((value) => (typeof value === "number" ? roundValue(value) : value))
    .join(", ");
}

function positionValueReadout(values: LaneValues): string | null {
  const x = values.x;
  const y = values.y;
  return typeof x === "number" && typeof y === "number"
    ? `${roundValue(x)}, ${roundValue(y)}`
    : null;
}

function rotationValueReadout(values: LaneValues): string | null {
  return typeof values.rotation === "number" ? `${roundValue(values.rotation)}°` : null;
}

function visualValueReadout(values: LaneValues): string | null {
  const opacity = values.opacity ?? values.autoAlpha;
  return typeof opacity === "number"
    ? `${roundValue(Math.abs(opacity) <= 1 ? opacity * 100 : opacity)}%`
    : null;
}

const GROUP_VALUE_READOUTS: Partial<
  Record<PropertyGroupName, (values: LaneValues) => string | null>
> = {
  position: positionValueReadout,
  rotation: rotationValueReadout,
  visual: visualValueReadout,
};

export function valueReadout(group: PropertyGroupName, values: LaneValues): string {
  return GROUP_VALUE_READOUTS[group]?.(values) ?? defaultValueReadout(values);
}
