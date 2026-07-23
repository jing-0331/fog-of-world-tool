import type { RouteSegment } from "@/lib/domain/types";
import {
  routeKindLabel,
  routeSourceLabel,
} from "@/lib/domain/provenance";

export interface GpxReportMetadata {
  unresolvedCount?: number;
  excludedCount?: number;
  skippedFlightCount?: number;
}

export interface BuildGpxInput {
  name: string;
  segments: RouteSegment[];
  report?: GpxReportMetadata;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlElement(name: string, value: string | number | boolean): string {
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

function normalizedTime(time: string): string {
  const milliseconds = Date.parse(time);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : time;
}

function routeExtension(segment: RouteSegment): string {
  const provenance = segment.provenance;
  const optionalFields = [
    provenance.referenceDate === null
      ? ""
      : xmlElement("fowt:referenceDate", provenance.referenceDate),
    provenance.originalMode === undefined
      ? ""
      : xmlElement("fowt:originalMode", provenance.originalMode),
    provenance.correctedMode === undefined
      ? ""
      : xmlElement("fowt:correctedMode", provenance.correctedMode),
  ].join("");

  return [
    `<fowt:route id="${escapeXml(segment.id)}">`,
    xmlElement("fowt:name", segment.name),
    xmlElement("fowt:mode", segment.mode),
    xmlElement("fowt:kind", provenance.kind),
    xmlElement("fowt:source", provenance.source),
    optionalFields,
    xmlElement("fowt:approximate", provenance.approximate),
    xmlElement("fowt:userOverride", provenance.userOverride ?? false),
    xmlElement("fowt:explanation", provenance.explanation),
    "</fowt:route>",
  ].join("");
}

function trackPoint(point: RouteSegment["points"][number]): string {
  const children = [
    point.elevationMeters === undefined
      ? ""
      : xmlElement("ele", point.elevationMeters),
    point.time === undefined ? "" : xmlElement("time", normalizedTime(point.time)),
  ].join("");

  return `<trkpt lat="${escapeXml(String(point.lat))}" lon="${escapeXml(
    String(point.lon),
  )}">${children}</trkpt>`;
}

function trackSegment(segment: RouteSegment): string {
  return `<trkseg>${segment.points.map(trackPoint).join("")}</trkseg>`;
}

export function buildGpx({
  name,
  segments,
  report = {},
}: BuildGpxInput): string {
  const sourceSummary = segments
    .map(
      (segment) =>
        `${segment.name}: ${routeKindLabel(segment.provenance.kind)} / ${routeSourceLabel(
          segment.provenance.source,
        )}`,
    )
    .join("；");
  const reportExtension = [
    "<fowt:report>",
    xmlElement("fowt:unresolvedCount", report.unresolvedCount ?? 0),
    xmlElement("fowt:excludedCount", report.excludedCount ?? 0),
    xmlElement("fowt:skippedFlightCount", report.skippedFlightCount ?? 0),
    "</fowt:report>",
  ].join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Fog of World GPX Tool"',
    ' xmlns="http://www.topografix.com/GPX/1/1"',
    ' xmlns:fowt="urn:fog-of-world-tool:extensions:v1">',
    "<metadata>",
    xmlElement("name", name),
    xmlElement("desc", sourceSummary),
    `<extensions>${reportExtension}</extensions>`,
    "</metadata>",
    "<trk>",
    xmlElement("name", name),
    xmlElement("desc", sourceSummary),
    `<extensions><fowt:routes>${segments
      .map(routeExtension)
      .join("")}</fowt:routes></extensions>`,
    segments.map(trackSegment).join(""),
    "</trk>",
    "</gpx>",
  ].join("");
}
