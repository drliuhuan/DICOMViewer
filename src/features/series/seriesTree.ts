/**
 * 四级元数据层级模型（FR-1.10 / FR-2.1 / FR-2.7，M2-D）：
 * 患者 → 检查 → 序列。实例层由 SeriesStack.items 承载。
 *
 * 全部为纯函数，可在 Node 环境下单元测试。
 */
import type { SeriesStack } from './buildStacks';

/** 检查节点：同一患者的某次检查（按 StudyInstanceUID 分组） */
export interface StudyNode {
  /** 分组键：StudyInstanceUID 缺失时回退「日期|描述」组合键 */
  key: string;
  date: string | undefined;
  description: string | undefined;
  series: SeriesStack[];
}

/** 患者节点：同一患者可并列多次检查（FR-2.7 随访对比） */
export interface PatientNode {
  /** 分组键：PatientID 缺失时回退姓名；两者皆缺失归入「未知患者」 */
  key: string;
  name: string;
  id: string | undefined;
  studies: StudyNode[];
}

const UNKNOWN_PATIENT_LABEL = '未知患者';

function patientKeyOf(stack: SeriesStack): string {
  if (stack.patientId) {
    return `id:${stack.patientId}`;
  }
  if (stack.patientName && stack.patientName !== '(无姓名)') {
    return `name:${stack.patientName}`;
  }
  return 'unknown';
}

function patientLabel(stack: SeriesStack): string {
  return stack.patientName && stack.patientName !== '(无姓名)'
    ? stack.patientName
    : UNKNOWN_PATIENT_LABEL;
}

function studyKeyOf(stack: SeriesStack): string {
  if (stack.studyInstanceUid) {
    return `uid:${stack.studyInstanceUid}`;
  }
  return `fallback:${stack.studyDate ?? ''}|${stack.studyDescription ?? ''}`;
}

/**
 * 将扁平序列列表组装为患者→检查→序列树。
 * - 同一患者（PatientID/姓名）的多次检查并列分组；
 * - 患者按姓名排序、检查按日期降序（新检查在前）、序列按序列 UID 排序，
 *   保证渲染顺序稳定。
 */
export function buildSeriesTree(stacks: readonly SeriesStack[]): PatientNode[] {
  const patients = new Map<string, PatientNode>();
  for (const stack of stacks) {
    const patientKey = patientKeyOf(stack);
    let patient = patients.get(patientKey);
    if (!patient) {
      patient = { key: patientKey, name: patientLabel(stack), id: stack.patientId, studies: [] };
      patients.set(patientKey, patient);
    }
    const studyKey = studyKeyOf(stack);
    let study = patient.studies.find((s) => s.key === studyKey);
    if (!study) {
      study = {
        key: studyKey,
        date: stack.studyDate,
        description: stack.studyDescription,
        series: [],
      };
      patient.studies.push(study);
    }
    study.series.push(stack);
  }

  const nodes = Array.from(patients.values());
  nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  for (const patient of nodes) {
    patient.studies.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '', 'en'));
    for (const study of patient.studies) {
      study.series.sort((a, b) => a.seriesUid.localeCompare(b.seriesUid, 'en'));
    }
  }
  return nodes;
}
