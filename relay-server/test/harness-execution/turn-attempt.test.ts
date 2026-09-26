import { describe, expect, it } from 'vitest'

describe('Conversation routing', () => {
  it('serializes Turns and versions Attempts', async () => {
    const routingModule = await import('../../src/harness-execution/conversation-routing.js').catch(
      () => ({})
    )
    const ConversationRouting = Reflect.get(routingModule, 'ConversationRouting')

    expect(ConversationRouting).toBeTypeOf('function')

    const routing = new ConversationRouting({
      createTurnId: sequence('turn'),
      createAttemptId: sequence('attempt'),
    })
    const firstTurn = routing.accept('conversation-1', { text: 'First request' })
    const secondTurn = routing.accept('conversation-1', { text: 'Second request' })

    const firstAttempt = routing.dispatch('conversation-1')
    expect(firstAttempt).toMatchObject({ id: 'attempt-1', turnId: firstTurn.id })
    expect(routing.inspect('conversation-1')).toEqual({
      active: {
        turn: firstTurn,
        attempt: firstAttempt,
      },
      backlog: [secondTurn],
    })
    expect(() => routing.dispatch('conversation-1')).toThrowError(
      'Conversation already has an active Harness Turn'
    )

    routing.release('conversation-1', firstAttempt.id)
    const nextAttempt = routing.dispatch('conversation-1', firstTurn.id)

    expect(nextAttempt).toMatchObject({ id: 'attempt-2', turnId: firstTurn.id })
    expect(nextAttempt.id).not.toBe(firstAttempt.id)
    expect(routing.inspect('conversation-1').backlog).toEqual([secondTurn])
  })
})

function sequence(prefix: string): () => string {
  let value = 0
  return () => `${prefix}-${++value}`
}
