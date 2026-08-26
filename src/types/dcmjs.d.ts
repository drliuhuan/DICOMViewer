/**
 * dcmjs 最小类型声明（仅声明本项目用到的小部分 API；SR 导出 FR-5.12）。
 */
declare module 'dcmjs' {
  export interface DicomDictLike {
    dict: Record<string, unknown>;
    meta: unknown;
    write(): ArrayBuffer;
  }

  export interface StructuredReportLike {
    dataset: Record<string, unknown>;
  }

  export interface DicomMessageReaderFacade {
    readFile(buffer: ArrayBuffer): { dict: Record<string, { Value?: unknown }> };
  }

  export interface DicomMetaDictionaryFacade {
    uid(): string;
    date(): string;
    time(): string;
    denaturalizeDataset(dataset: Record<string, unknown>): Record<string, unknown>;
  }

  export const derivations: {
    StructuredReport: {
      new (datasets: unknown[]): StructuredReportLike;
    };
  };

  /** cornerstone V4 测量适配器（SR 导出 FR-5.12 使用） */
  export const adapters: {
    Cornerstone: {
      MeasurementReport: {
        generateReport(
          toolState: Record<string, Record<string, unknown[]>>,
          metadataProvider: { get: (type: string, imageId: string) => unknown },
          options?: Record<string, unknown>,
        ): StructuredReportLike;
      };
    };
  };

  export const data: {
    DicomDict: new (meta: Record<string, unknown>) => DicomDictLike;
    DicomMessage: DicomMessageReaderFacade;
    DicomMetaDictionary: DicomMetaDictionaryFacade;
    datasetToDict(dataset: Record<string, unknown>): DicomDictLike;
    datasetToBuffer(dataset: Record<string, unknown>): Uint8Array;
  };

  export default {
    derivations,
    data,
  };
}