// Native motion port of MOTION STUDY / 04 (2026-09-14). No preview DOM or dependencies.
export const DURATION = 3000
export const SETTLE = 480
export const clamp = (x: number) => Math.min(1, Math.max(0, x))
export const smooth = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t) }
const ease = (t: number, a: number, b: number) => 1 - Math.pow(1 - clamp((t - a) / (b - a)), 3)
const spectrum = ['70DDB7','80CDF2','B0A2F2','DDA7E8','F5ABC0','F8C68F','E6DD8D'].map(hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)))
export function colors(ms: number) {
  return [0, 1, 2, 3, 4].map(stop => {
    const x = (((ms / 5600 + stop * .11) % 1 + 1) % 1) * spectrum.length
    const i = Math.floor(x), f = smooth(x - i)
    return `rgb(${spectrum[i]!.map((v, c) => Math.round(v + (spectrum[(i + 1) % spectrum.length]![c]! - v) * f)).join(',')})`
  })
}
const poses = [
  [0, [0,0,0,1], [0,0,0,1]],
  [.22, [-12,-9,-2,1.022], [14,10,2.4,1.030]],
  [.47, [-8,-20,-1.1,1.025], [10,16,1.8,1.010]],
  [.69, [-10,12,1.2,1.012], [12,-16,-1.6,1.025]],
  [.86, [-3,-4,-.45,1.004], [4,5,.6,1.006]],
  [1, [0,0,0,1], [0,0,0,1]],
] as const
export function hoverPose(ms: number, amount: number, reduced: boolean) {
  if (reduced) return ['none', 'none']
  const phase = (ms % 3600) / 3600
  const index = Math.max(0, poses.findIndex((p, i) => i < poses.length - 1 && phase >= p[0] && phase < poses[i + 1]![0]))
  const a = poses[index]!, b = poses[index + 1]!, f = smooth((phase - a[0]) / (b[0] - a[0]))
  return ([1, 2] as const).map(i => {
    const p = a[i].map((v, j) => v + (b[i][j]! - v) * f)
    return `translate(${p[0]! * amount}px,${p[1]! * amount}px) rotate(${p[2]! * amount}deg) scale(${1 + (p[3]! - 1) * amount})`
  })
}
export function arrivalPose(ms: number, reduced: boolean) {
  const t = clamp(ms / DURATION) * 3, enter = ease(t, .08, 1.03), exit = smooth((t - 2.32) / .68), title = ease(t, .78, 1.38)
  return {
    opacity: 1 - exit, scale: 1 - (reduced ? 0 : .035 * exit),
    leftOpacity: ease(t, .04, .36), rightOpacity: ease(t, .14, .52), wordOpacity: title,
    left: reduced ? 'none' : `translate(${-92 * (1-enter)}px,${18 * (1-enter)}px) rotate(${-5 * (1-enter)}deg)`,
    right: reduced ? 'none' : `translate(${105 * (1-enter)}px,${-24 * (1-enter)}px) rotate(${7 * (1-enter)}deg)`,
    wordY: 530 + (reduced ? 0 : 14 * (1-title)), amount: 1 - smooth((t - 1.12) / .9),
  }
}
