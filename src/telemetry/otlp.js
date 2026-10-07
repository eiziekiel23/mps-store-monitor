/**
 * Converts internal monitor test spans to the standard OpenTelemetry (OTLP/JSON) trace format.
 * Shape: ExportTraceServiceRequest
 */
export function buildOtlpTrace({ traceId, runId, region = 'gha-us', spans = [] }) {
  const otlpSpans = spans.map(s => {
    const attributes = [
      { key: 'service.name', value: { stringValue: 'mps-store-monitor' } },
      { key: 'run_id', value: { stringValue: String(runId) } },
      { key: 'region', value: { stringValue: String(region) } },
      ...Object.entries(s.attributes || {}).map(([k, v]) => {
        if (typeof v === 'number') {
          return Number.isInteger(v)
            ? { key: k, value: { intValue: v } }
            : { key: k, value: { doubleValue: v } };
        }
        if (typeof v === 'boolean') {
          return { key: k, value: { boolValue: v } };
        }
        return { key: k, value: { stringValue: String(v) } };
      })
    ];

    return {
      traceId,
      spanId: s.spanId,
      parentSpanId: s.parentSpanId || undefined,
      name: s.name,
      kind: 1, // SPAN_KIND_INTERNAL
      startTimeUnixNano: String(BigInt(Math.floor(s.startMs)) * 1000000n),
      endTimeUnixNano: String(BigInt(Math.floor(s.endMs)) * 1000000n),
      attributes,
      status: {
        code: s.status === 'error' ? 2 : 1 // 2 = STATUS_CODE_ERROR, 1 = STATUS_CODE_OK
      }
    };
  });

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'mps-store-monitor' } }
          ]
        },
        scopeSpans: [
          {
            scope: { name: 'mps-monitor-playwright' },
            spans: otlpSpans
          }
        ]
      }
    ]
  };
}
