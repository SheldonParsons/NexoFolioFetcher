// Pure scheduling policy; screenshots are only requested after the background has
// rechecked active tab/document/view/auth. Reused content is not a new screenshot.
export class ScreenshotPolicy {
  private captures: number[] = []
  private last = -Infinity
  private completed = new Map<string, string>()
  reuse(stateKey: string) { return this.completed.get(stateKey) }
  allow(now: number) {
    this.captures = this.captures.filter(time => now - time < 60000)
    if (now - this.last < 3000 || this.captures.length >= 10) return false
    this.last = now; this.captures.push(now); return true
  }
  remember(stateKey: string, assetId: string) {
    this.completed.set(stateKey, assetId)
    while (this.completed.size > 100) this.completed.delete(this.completed.keys().next().value!)
  }
}
