/**
 * FSD-aware prompt templates for LLM analysis.
 */

import type { FsdLayer } from "./types";
import { LAYER_DESCRIPTIONS } from "./types";

const FSD_CONTEXT = `你是 FSD（Feature-Sliced Design）架构分析助手。
FSD 将前端项目分为六层（从上到下）：app → pages → widgets → features → entities → shared。
上层可引用下层，禁止反向引用。同层切片（Slice）之间禁止互相引用（entities 层例外，允许规范化交叉引用）。
每个切片内部按 Segment 组织：ui（视觉组件）、api（网络请求）、model（数据/状态/hook）、lib（业务工具）、config（配置）。`;

export function sliceSystemPrompt(layer: FsdLayer): string {
  return `${FSD_CONTEXT}

当前分析的是「${layer}」层的一个切片（Slice）。
${layer} 层的职责：${LAYER_DESCRIPTIONS[layer]}

请基于实际源码分析，不要编造。全部使用中文。`;
}

export function sliceUserPrompt(
  layer: FsdLayer,
  sliceName: string,
  segmentNames: string[],
  filesSection: string,
  publicApiNames: string[],
): string {
  return `切片路径：${layer}/${sliceName}
包含 Segment：${segmentNames.length ? segmentNames.join("、") : "无子目录，文件直接放在切片根目录"}
${publicApiNames.length ? `公共 API（从 index 文件提取）：${publicApiNames.join(", ")}\n` : ""}
以下为各 Segment 下的文件内容（可能截断）：

${filesSection}

请按 JSON schema 输出：
- summary：该切片的业务功能描述
- scenarios：使用场景列表
- conventions：观察到的编码约定
- publicApi：公共导出名列表
- segments：各 Segment 的 name、summary、files（name/purpose/exports）
全部中文。`;
}

export function directLayerSystemPrompt(layer: FsdLayer): string {
  return `${FSD_CONTEXT}

当前分析的是「${layer}」层（无切片层，内部直接按 Segment 组织）。
${layer} 层的职责：${LAYER_DESCRIPTIONS[layer]}

请基于实际源码分析，不要编造。全部使用中文。`;
}

export function directLayerUserPrompt(
  layer: FsdLayer,
  segmentNames: string[],
  filesSection: string,
): string {
  return `层路径：${layer}
包含 Segment：${segmentNames.length ? segmentNames.join("、") : "无子目录"}

以下为各 Segment 下的文件内容（可能截断）：

${filesSection}

请按 JSON schema 输出：
- summary：该层的整体职责描述
- segments：各 Segment 的 name、summary、files（name/purpose/exports）
全部中文。`;
}
