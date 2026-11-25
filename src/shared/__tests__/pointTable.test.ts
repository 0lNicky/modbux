import { describe, expect, it } from 'vitest'
import {
  acceptedPoints,
  clientMappingOf,
  engineeringToRaw,
  Point,
  pointComment,
  PointGeneratorSchema,
  PointSchema,
  readWindowOf,
  resolveAddress,
  ServerPoint,
  serverRegisterParams,
  serverUnitsOf,
  validatePointTable
} from '../pointTable'
import { scaleValue } from '../engineeringValue'
import { nextRampTick } from '../ramp'
import { DataType, RegisterParamsSchema } from '../types'

const point = (fields: Partial<Point> & Pick<Point, 'address'>): Point => ({
  name: `P${fields.address}`,
  registerType: 'holding_registers',
  dataType: 'uint16',
  ...fields
})

const reasons = (report: ReturnType<typeof validatePointTable>): (string | undefined)[] =>
  report.points.map((entry) => entry.reason)

describe('resolveAddress', () => {
  it.each([
    ['pdu0', 0, 0],
    ['pdu0', 65535, 65535],
    ['pdu0', '17', 17],
    ['one_based', 1, 0],
    ['one_based', 65536, 65535],
    ['one_based', '100', 99]
  ] as const)('%s %s is PDU address %s', (notation, address, pdu) => {
    expect(resolveAddress(address, notation, 'input_registers')).toEqual({
      ok: true,
      registerType: 'input_registers',
      address: pdu
    })
  })

  it.each([
    ['pdu0', -1, 'pdu0 address -1 is outside 0 to 65535'],
    ['pdu0', 65536, 'pdu0 address 65536 is outside 0 to 65535'],
    ['one_based', 0, 'one_based address 0 is outside 1 to 65536'],
    ['one_based', 65537, 'one_based address 65537 is outside 1 to 65536']
  ] as const)('refuses %s %s', (notation, address, reason) => {
    expect(resolveAddress(address, notation, 'coils')).toEqual({ ok: false, reason })
  })

  it('refuses a pdu0 or one_based address with no register type', () => {
    expect(resolveAddress(3, 'pdu0')).toEqual({
      ok: false,
      reason: 'A pdu0 address needs a registerType'
    })
    expect(resolveAddress(3, 'one_based')).toEqual({
      ok: false,
      reason: 'A one_based address needs a registerType'
    })
  })

  describe('modicon', () => {
    it.each([
      ['00001', 'coils', 0],
      [1, 'coils', 0],
      ['09999', 'coils', 9998],
      [10001, 'discrete_inputs', 0],
      [30001, 'input_registers', 0],
      [39999, 'input_registers', 9998],
      [40001, 'holding_registers', 0],
      ['40100', 'holding_registers', 99],
      ['000001', 'coils', 0],
      [100001, 'discrete_inputs', 0],
      [300001, 'input_registers', 0],
      [400001, 'holding_registers', 0],
      [465536, 'holding_registers', 65535],
      ['065536', 'coils', 65535]
    ] as const)('%s is %s %s', (address, registerType, pdu) => {
      expect(resolveAddress(address, 'modicon')).toEqual({ ok: true, registerType, address: pdu })
    })

    it('takes a register type that agrees with the prefix', () => {
      expect(resolveAddress(40002, 'modicon', 'holding_registers')).toEqual({
        ok: true,
        registerType: 'holding_registers',
        address: 1
      })
    })

    it.each([
      [
        40001,
        'input_registers',
        'Modicon address 40001 is holding_registers, and the point says input_registers'
      ],
      [
        20001,
        undefined,
        'Modicon address 20001 starts with 2, which names no register type (0, 1, 3 or 4)'
      ],
      [
        50001,
        undefined,
        'Modicon address 50001 starts with 5, which names no register type (0, 1, 3 or 4)'
      ],
      [40000, undefined, 'Modicon address 40000 has offset 0, outside 1 to 9999'],
      [400000, undefined, 'Modicon address 400000 has offset 0, outside 1 to 65536'],
      [465537, undefined, 'Modicon address 465537 has offset 65537, outside 1 to 65536'],
      ['4001', undefined, 'Modicon address 4001 is not five or six digits'],
      ['4000001', undefined, 'Modicon address 4000001 is not five or six digits'],
      [1000000, undefined, 'Modicon address 1000000 is not five or six digits'],
      [-1, undefined, 'Modicon address -1 is not five or six digits']
    ] as const)('refuses %s', (address, registerType, reason) => {
      expect(resolveAddress(address, 'modicon', registerType)).toEqual({ ok: false, reason })
    })
  })
})

describe('engineeringToRaw', () => {
  it.each([
    ['int16', -32768, -32768],
    ['uint16', 65535, 65535],
    ['int32', -2147483648, -2147483648],
    ['uint32', 4294967295, 4294967295],
    ['int64', -9007199254740991, -9007199254740991],
    ['uint64', 9007199254740991, 9007199254740991],
    ['float', 1.5, 1.5],
    ['double', 1e300, 1e300],
    ['bitmap', 0xff00, 0xff00],
    ['unix', 1700000000, 1700000000],
    ['datetime', Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 1)]
  ] as const)('%s takes %s unscaled as %s', (dataType, value, raw) => {
    expect(engineeringToRaw(value, dataType)).toEqual({ ok: true, raw })
  })

  it.each([
    ['int16', 32768, 'Raw value 32768: A int16 value has to be between -32768 and 32767'],
    ['int16', -32769, 'Raw value -32769: A int16 value has to be between -32768 and 32767'],
    ['uint16', -1, 'Raw value -1: A uint16 value has to be between 0 and 65535'],
    ['uint16', 65536, 'Raw value 65536: A uint16 value has to be between 0 and 65535'],
    [
      'int32',
      2147483648,
      'Raw value 2147483648: A int32 value has to be between -2147483648 and 2147483647'
    ],
    [
      'uint32',
      4294967296,
      'Raw value 4294967296: A uint32 value has to be between 0 and 4294967295'
    ],
    ['uint64', -1, 'Raw value -1: A uint64 value has to be between 0 and 9007199254740991'],
    ['bitmap', 65536, 'Raw value 65536: A bitmap value has to be between 0 and 65535'],
    ['float', 1e39, 'Raw value 1e+39 is beyond what a float holds'],
    ['unix', -1, 'A unix value has to be between 0 and 4294967295'],
    ['datetime', 0, 'A datetime value has to be between 946684800000 and 4985971199999']
  ] as const)('refuses %s %s', (dataType, value, reason) => {
    expect(engineeringToRaw(value, dataType)).toEqual({ ok: false, reason })
  })

  it.each(['int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'bitmap', 'unix'] as const)(
    'refuses a fraction for %s',
    (dataType) => {
      expect(engineeringToRaw(1.5, dataType)).toEqual({
        ok: false,
        reason: `Engineering value 1.5 is raw 1.5, and a ${dataType} holds whole numbers`
      })
    }
  )

  it.each(['utf8', 'none'] as const)('refuses %s, which holds no number', (dataType) => {
    expect(engineeringToRaw(1, dataType)).toEqual({
      ok: false,
      reason: `A ${dataType} point holds no number`
    })
  })

  it.each([NaN, Infinity])('refuses %s', (value) => {
    expect(engineeringToRaw(value, 'double')).toEqual({
      ok: false,
      reason: `${value} is not a finite number`
    })
  })

  // `scaleValue` is what the client grid shows, so the raw value read back
  // through it has to give the engineering value asked for.
  it.each([
    ['int16', -12.3, 0.1, -123],
    ['uint16', 230.5, 0.1, 2305],
    ['int32', -123456, 1, -123456],
    ['uint32', 4000000.25, 0.01, 400000025],
    ['int64', 12.5, 0.5, 25],
    ['uint64', 1000, 10, 100],
    ['float', 230.5, 0.1, 2305],
    ['double', -1.25, 0.001, -1250]
  ] as const)(
    '%s at %s with factor %s is raw %s, and reads back',
    (dataType, value, factor, raw) => {
      const conversion = engineeringToRaw(value, dataType, { scalingFactor: factor })
      expect(conversion).toEqual({ ok: true, raw })
      expect(scaleValue(String(raw), dataType, { scalingFactor: factor })).toBe(value)
    }
  )

  it('undoes a negative factor', () => {
    expect(engineeringToRaw(-50, 'int16', { scalingFactor: -0.5 })).toEqual({ ok: true, raw: 100 })
  })

  it('refuses a value whose raw is no whole number under the factor', () => {
    expect(engineeringToRaw(230.05, 'uint16', { scalingFactor: 0.1 })).toEqual({
      ok: false,
      reason: 'Engineering value 230.05 is raw 2300.5, and a uint16 holds whole numbers'
    })
  })

  it('refuses a scaled raw value outside the type', () => {
    expect(engineeringToRaw(6553.6, 'uint16', { scalingFactor: 0.1 })).toEqual({
      ok: false,
      reason: 'Raw value 65536: A uint16 value has to be between 0 and 65535'
    })
  })

  it('refuses a factor of 0', () => {
    expect(engineeringToRaw(1, 'int16', { scalingFactor: 0 })).toEqual({
      ok: false,
      reason: 'A scaling factor of 0 maps every raw value to 0'
    })
  })

  it('undoes the interpolation, then the factor', () => {
    // 4 to 20 mA on 0 to 100 %, the raw word in tenths of a mA.
    const scaling = { scalingFactor: 0.1, interpolate: { x1: 4, x2: 20, y1: 0, y2: 100 } }
    const conversion = engineeringToRaw(50, 'uint16', scaling)

    expect(conversion).toEqual({ ok: true, raw: 120 })
    expect(
      scaleValue('120', 'uint16', {
        scalingFactor: 0.1,
        interpolate: { x1: '4', x2: '20', y1: '0', y2: '100' }
      })
    ).toBe(50)
  })

  it.each([[{ x1: 4, x2: 4, y1: 0, y2: 100 }], [{ x1: 4, x2: 20, y1: 7, y2: 7 }]])(
    'refuses an interpolation that answers one value everywhere',
    (interpolate) => {
      expect(engineeringToRaw(7, 'uint16', { interpolate })).toEqual({
        ok: false,
        reason: 'The interpolation answers one value everywhere, so no raw value maps back'
      })
    }
  )

  it.each(['bitmap', 'unix', 'datetime'] as const)('refuses a scaling on %s', (dataType) => {
    expect(engineeringToRaw(1, dataType, { scalingFactor: 2 })).toMatchObject({
      ok: false,
      reason: expect.stringContaining(`not ${dataType}`)
    })
  })

  it('takes a factor of 1 on a type that takes no scaling', () => {
    expect(engineeringToRaw(5, 'bitmap', { scalingFactor: 1 })).toEqual({ ok: true, raw: 5 })
  })
})

describe('pointComment', () => {
  it('joins the name, the unit and the comment', () => {
    expect(pointComment({ name: 'Voltage L1', unit: 'V', comment: 'phase to neutral' })).toBe(
      'Voltage L1 [V] phase to neutral'
    )
    expect(pointComment({ name: 'Status', comment: '' })).toBe('Status')
  })
})

describe('validatePointTable, one point at a time', () => {
  it('resolves an accepted point', () => {
    const report = validatePointTable(
      [
        {
          name: 'Voltage',
          address: 40001,
          dataType: 'float',
          byteOrder: 'CDAB',
          scalingFactor: 0.1,
          unit: 'V'
        }
      ],
      { target: 'client', notation: 'modicon' }
    )

    expect(report).toEqual({
      byteOrder: 'CDAB',
      accepted: 1,
      rejected: 0,
      points: [
        {
          index: 0,
          name: 'Voltage',
          status: 'accepted',
          resolved: {
            unitId: 0,
            registerType: 'holding_registers',
            address: 0,
            width: 2,
            dataType: 'float',
            byteOrder: 'CDAB',
            scalingFactor: 0.1,
            comment: 'Voltage [V]'
          }
        }
      ]
    })
  })

  it("takes a point's own notation over the table's", () => {
    const report = validatePointTable([point({ address: 40010, notation: 'modicon' })], {
      target: 'client',
      notation: 'one_based'
    })
    expect(report.points[0]?.resolved?.address).toBe(9)
  })

  it('rejects an unknown data type, and none', () => {
    const report = validatePointTable(
      [point({ address: 0, dataType: 'float32' }), point({ address: 1, dataType: 'none' })],
      { target: 'client' }
    )
    expect(reasons(report)).toEqual(['Data type float32 is unknown', 'Data type none is unknown'])
  })

  it('rejects a register point with no data type', () => {
    const report = validatePointTable([point({ address: 0, dataType: undefined })], {
      target: 'client'
    })
    expect(reasons(report)).toEqual(['A holding_registers point needs a dataType'])
  })

  it('takes a bit with no data type, or bool, and rejects one with a number type', () => {
    const report = validatePointTable(
      [
        { name: 'Run', address: 0, registerType: 'coils' },
        { name: 'Trip', address: 1, registerType: 'discrete_inputs', dataType: 'bool' },
        { name: 'Bad', address: 2, registerType: 'coils', dataType: 'int16' }
      ],
      { target: 'client' }
    )
    expect(reasons(report)).toEqual([
      undefined,
      undefined,
      'A coils point holds one bit; give it no dataType (or bool)'
    ])
  })

  it('rejects an address out of range, naming the notation', () => {
    const report = validatePointTable([point({ address: 0 })], {
      target: 'client',
      notation: 'one_based'
    })
    expect(reasons(report)).toEqual(['one_based address 0 is outside 1 to 65536'])
    expect(report.points[0]?.resolved).toBeUndefined()
  })

  it('rejects a point that runs past the last address, and takes one that ends on it', () => {
    const report = validatePointTable(
      [
        point({ address: 65533, dataType: 'double' }),
        point({ address: 65532, dataType: 'double' })
      ],
      { target: 'client' }
    )
    expect(reasons(report)).toEqual(['4 registers from 65533 run past 65535', undefined])
  })

  it('reads the width of a utf8 point off its length', () => {
    const report = validatePointTable(
      [
        point({ address: 0, dataType: 'utf8', length: 4 }),
        point({ address: 10, dataType: 'utf8' })
      ],
      { target: 'client' }
    )
    expect(report.points.map((entry) => entry.resolved?.width)).toEqual([4, 10])
  })

  it.each(['int16', 'uint16', 'bitmap', 'utf8'])('rejects a byte swap on %s', (dataType) => {
    const report = validatePointTable(
      [
        point({ address: 0, dataType, byteOrder: 'BADC' }),
        point({ address: 20, dataType, byteOrder: 'DCBA' })
      ],
      { target: 'client' }
    )
    expect(reasons(report)).toEqual([
      `Byte order BADC swaps bytes, which applies to 32 and 64 bit types, not ${dataType}`,
      `Byte order DCBA swaps bytes, which applies to 32 and 64 bit types, not ${dataType}`
    ])
  })

  it('takes a word order on a 16 bit type, which sets nothing for the table', () => {
    const report = validatePointTable(
      [
        point({ address: 0, dataType: 'int16', byteOrder: 'CDAB' }),
        point({ address: 1, dataType: 'int32', byteOrder: 'ABCD' })
      ],
      { target: 'client' }
    )
    expect(reasons(report)).toEqual([undefined, undefined])
    expect(report.byteOrder).toBe('ABCD')
  })

  it.each(['int32', 'uint32', 'float', 'unix', 'int64', 'uint64', 'double', 'datetime'])(
    'takes a byte swap on %s',
    (dataType) => {
      const report = validatePointTable([point({ address: 0, dataType, byteOrder: 'DCBA' })], {
        target: 'client'
      })
      expect(report.points[0]?.status).toBe('accepted')
      expect(report.byteOrder).toBe('DCBA')
    }
  )

  it('rejects a scaling on a type that takes none', () => {
    const report = validatePointTable(
      [
        point({ address: 0, dataType: 'unix', scalingFactor: 0.1 }),
        point({
          address: 2,
          dataType: 'utf8',
          length: 1,
          interpolate: { x1: 0, x2: 1, y1: 0, y2: 2 }
        })
      ],
      { target: 'client' }
    )
    expect(reasons(report)).toEqual([
      'A scaling factor or interpolation applies to int16, uint16, int32, uint32, int64, uint64, float, double, not unix',
      'A scaling factor or interpolation applies to int16, uint16, int32, uint32, int64, uint64, float, double, not utf8'
    ])
  })

  it('rejects a scaling factor of 0 on a client point', () => {
    const report = validatePointTable([point({ address: 0, scalingFactor: 0 })], {
      target: 'client'
    })
    expect(reasons(report)).toEqual(['A scaling factor of 0 maps every raw value to 0'])
  })
})

describe('validatePointTable, across the table', () => {
  it("rejects a byte order other than the table's", () => {
    const report = validatePointTable(
      [
        point({ address: 0, dataType: 'float', byteOrder: 'CDAB' }),
        point({ address: 2, dataType: 'int32', byteOrder: 'ABCD' }),
        point({ address: 4, dataType: 'uint32' })
      ],
      { target: 'client' }
    )
    expect(reasons(report)).toEqual([
      undefined,
      "Byte order ABCD differs from the table's CDAB; one configuration has one byte order",
      undefined
    ])
    expect(report.byteOrder).toBe('CDAB')
  })

  it('takes the byte order the table names over the first point', () => {
    const report = validatePointTable(
      [
        point({ address: 0, dataType: 'float', byteOrder: 'CDAB' }),
        point({ address: 2, dataType: 'float', byteOrder: 'DCBA' })
      ],
      { target: 'server', byteOrder: 'DCBA' }
    )
    expect(reasons(report)).toEqual([
      "Byte order CDAB differs from the table's DCBA; one configuration has one byte order",
      undefined
    ])
    expect(report.byteOrder).toBe('DCBA')
  })

  it('leaves the byte order unset when no point names one', () => {
    const report = validatePointTable([point({ address: 0, dataType: 'float' })], {
      target: 'client'
    })
    expect(report.byteOrder).toBeUndefined()
  })

  it("lets a rejected point's byte order set nothing", () => {
    const report = validatePointTable(
      [
        point({ address: 65535, dataType: 'float', byteOrder: 'CDAB' }),
        point({ address: 0, dataType: 'float', byteOrder: 'ABCD' })
      ],
      { target: 'client' }
    )
    expect(reasons(report)).toEqual(['2 registers from 65535 run past 65535', undefined])
    expect(report.byteOrder).toBe('ABCD')
  })

  it("rejects a client point under another unit id than the table's", () => {
    const report = validatePointTable(
      [point({ address: 0, unitId: 3 }), point({ address: 1, unitId: 4 }), point({ address: 2 })],
      { target: 'client' }
    )
    expect(reasons(report)).toEqual([
      undefined,
      "Unit id 4 differs from the table's 3; one client configuration reads one unit id",
      undefined
    ])
    expect(report.unitId).toBe(3)
    expect(report.points.map((entry) => entry.resolved?.unitId)).toEqual([3, 4, 3])
  })

  it("takes the table's unit id over the first point's", () => {
    const report = validatePointTable([point({ address: 0, unitId: 3 })], {
      target: 'client',
      unitId: 1
    })
    expect(reasons(report)).toEqual([
      "Unit id 3 differs from the table's 1; one client configuration reads one unit id"
    ])
  })

  it('takes several unit ids on a server table', () => {
    const report = validatePointTable(
      [point({ address: 0, unitId: 3 }), point({ address: 0, unitId: 4 }), point({ address: 0 })],
      { target: 'server', unitId: 1 }
    )
    expect(reasons(report)).toEqual([undefined, undefined, undefined])
    expect(report.points.map((entry) => entry.resolved?.unitId)).toEqual([3, 4, 1])
    expect(report.unitId).toBeUndefined()
  })

  it('rejects a point overlapping one accepted before it, on the same type and unit', () => {
    const report = validatePointTable(
      [
        point({ name: 'Energy', address: 10, dataType: 'uint64' }),
        point({ name: 'Inside', address: 13, dataType: 'uint16' }),
        point({ name: 'Across', address: 9, dataType: 'int32' }),
        point({ name: 'After', address: 14, dataType: 'uint16' }),
        point({ name: 'Other type', address: 10, registerType: 'input_registers' })
      ],
      { target: 'client' }
    )
    expect(reasons(report)).toEqual([
      undefined,
      'holding_registers 13 to 13 overlaps "Energy" at 10',
      'holding_registers 9 to 10 overlaps "Energy" at 10',
      undefined,
      undefined
    ])
  })

  // A client reads one unit id, so a point naming another is still read at
  // the address it shares.
  it('rejects an overlap on a client table whatever unit id each point names', () => {
    const report = validatePointTable(
      [
        point({ name: 'A', address: 100, dataType: 'uint32' }),
        point({ name: 'B', address: 101, dataType: 'uint16', unitId: 1 })
      ],
      { target: 'client' }
    )
    expect(reasons(report)).toEqual([undefined, 'holding_registers 101 to 101 overlaps "A" at 100'])
    expect(report.points[0]?.resolved?.unitId).toBe(report.unitId ?? 0)
  })

  it('takes the same address on two units of a server table', () => {
    const report = validatePointTable(
      [point({ address: 100, dataType: 'uint32' }), point({ address: 101, unitId: 1 })],
      { target: 'server' }
    )
    expect(reasons(report)).toEqual([undefined, undefined])
  })

  it('lets a rejected point block nothing', () => {
    const report = validatePointTable(
      [point({ address: 10, dataType: 'float32' }), point({ address: 10 })],
      { target: 'client' }
    )
    expect(reasons(report)).toEqual(['Data type float32 is unknown', undefined])
    expect([report.accepted, report.rejected]).toEqual([1, 1])
  })
})

describe('validatePointTable, server values', () => {
  const serverPoint = (
    fields: Partial<ServerPoint> & Pick<ServerPoint, 'address'>
  ): ServerPoint => ({
    ...point(fields),
    ...fields
  })

  it('stores the raw value of a fixed engineering value', () => {
    const report = validatePointTable(
      [serverPoint({ address: 0, dataType: 'float', scalingFactor: 0.1, value: 230.5 })],
      { target: 'server' }
    )
    expect(report.points[0]?.resolved).toMatchObject({ raw: 2305 })
  })

  it('stores raw 0 for a register with neither a value nor a generator, and false for a bit', () => {
    const report = validatePointTable(
      [serverPoint({ address: 0 }), { name: 'Run', address: 0, registerType: 'coils' }],
      { target: 'server' }
    )
    expect(report.points.map((entry) => entry.resolved?.raw)).toEqual([0, false])
  })

  it('stores a generator range in raw values, lowest first', () => {
    const report = validatePointTable(
      [
        serverPoint({
          address: 0,
          dataType: 'int16',
          scalingFactor: -0.1,
          generator: { min: 10, max: 20, intervalSeconds: 5 }
        })
      ],
      { target: 'server' }
    )
    expect(report.points[0]?.resolved?.generator).toEqual({
      min: -200,
      max: -100,
      intervalMs: 5000
    })
  })

  it('gives a timestamp generator the range the store pins, and rejects one with a range', () => {
    const report = validatePointTable(
      [
        serverPoint({ address: 0, dataType: 'unix', generator: {} }),
        serverPoint({ address: 2, dataType: 'datetime', generator: { min: 0, max: 1 } })
      ],
      { target: 'server' }
    )
    expect(report.points[0]?.resolved?.generator).toEqual({ min: 0, max: 0, intervalMs: 1000 })
    expect(reasons(report)).toEqual([
      undefined,
      'A datetime generator reads the clock and takes no min or max'
    ])
  })

  describe('a ramp generator', () => {
    // It said a whole raw step for every type, and an unscaled double takes 0.5.
    it('describes the raw rules of a ramp step and start per data type', () => {
      const description = PointGeneratorSchema.shape.step.description
      expect(description).toContain('On an integer type the raw step is whole')
      expect(description).toContain('7 raw decimals')
      expect(description).toContain('more than a tenth of a step from the values asked for')
      expect(PointGeneratorSchema.shape.start.description).toContain(
        'refused if that moves it by more than a tenth of a step'
      )
      const report = validatePointTable(
        [
          serverPoint({
            address: 0,
            dataType: 'double',
            generator: { mode: 'ramp', start: 0, step: 0.5, min: 0, max: 3 }
          })
        ],
        { target: 'server' }
      )
      expect(report.points[0]?.resolved?.generator?.step).toBe(0.5)
    })

    const ramp = { mode: 'ramp', start: 0, step: 1, min: 0, max: 100 } as const
    const resolve = (fields: Partial<ServerPoint>): ReturnType<typeof validatePointTable> =>
      validatePointTable([serverPoint({ address: 0, ...fields })], { target: 'server' })

    it('stores the ramp in raw values, restart on by default', () => {
      const report = resolve({ generator: ramp })
      expect(report.points[0]?.resolved?.generator).toEqual({
        min: 0,
        max: 100,
        intervalMs: 1000,
        mode: 'ramp',
        start: 0,
        step: 1,
        restart: true
      })
    })

    it('keeps restart: false', () => {
      const report = resolve({ generator: { ...ramp, restart: false, intervalSeconds: 2 } })
      expect(report.points[0]?.resolved?.generator).toMatchObject({
        intervalMs: 2000,
        restart: false
      })
    })

    it('scales start, step, min and max into raw values', () => {
      const report = resolve({
        scalingFactor: 0.1,
        generator: { mode: 'ramp', start: 80, step: -0.5, min: 20, max: 80 }
      })
      expect(report.points[0]?.resolved?.generator).toMatchObject({
        start: 800,
        step: -5,
        min: 200,
        max: 800
      })
    })

    it('turns the direction around under a negative scaling factor', () => {
      const report = resolve({
        dataType: 'int16',
        scalingFactor: -1,
        generator: { mode: 'ramp', start: 10, step: 1, min: 1, max: 50 }
      })
      expect(report.points[0]?.resolved?.generator).toMatchObject({
        start: -10,
        step: -1,
        min: -50,
        max: -1
      })
    })

    it('resolves a generator with no mode exactly as before', () => {
      const report = resolve({ generator: { min: 0, max: 10 } })
      expect(report.points[0]?.resolved?.generator).toStrictEqual({
        min: 0,
        max: 10,
        intervalMs: 1000
      })
    })

    it('resolves mode random as a random generator', () => {
      const report = resolve({ generator: { mode: 'random', min: 0, max: 10 } })
      expect(report.points[0]?.resolved?.generator).toStrictEqual({
        min: 0,
        max: 10,
        intervalMs: 1000
      })
    })

    it('hands the schema a ramp it accepts', () => {
      const [entry] = resolve({ generator: ramp, comment: 'Energy' }).points
      const resolved = entry?.resolved
      if (!resolved) throw new Error('the ramp was rejected')
      const params = serverRegisterParams(resolved)
      expect(RegisterParamsSchema.safeParse(params).success).toBe(true)
      expect(params).toMatchObject({ mode: 'ramp', start: 0, step: 1, restart: true })
    })

    it.each([
      [
        { dataType: 'uint16', generator: { mode: 'ramp', start: 0, min: 0, max: 10 } },
        'A ramp needs a start, a step, a min and a max'
      ],
      [
        { dataType: 'uint16', generator: { mode: 'ramp', start: 0, step: 1, min: 0 } },
        'A ramp needs a start, a step, a min and a max'
      ],
      [{ dataType: 'unix', generator: ramp }, 'A unix generator reads the clock and cannot ramp'],
      [
        { dataType: 'datetime', generator: ramp },
        'A datetime generator reads the clock and cannot ramp'
      ],
      [
        { dataType: 'uint16', generator: { ...ramp, start: -1 } },
        'Ramp start: Raw value -1: A uint16 value has to be between 0 and 65535'
      ],
      [{ dataType: 'uint16', generator: { ...ramp, step: 0 } }, 'The ramp step is 0 after scaling'],
      [
        { dataType: 'uint16', generator: { ...ramp, start: 11, max: 10 } },
        'The ramp start has to be between its min and max'
      ],
      [
        { dataType: 'uint16', generator: { min: 0, max: 10, start: 1 } },
        'start, step and restart belong to a ramp; set mode to "ramp"'
      ],
      [
        { dataType: 'uint16', generator: { mode: 'random', min: 0, max: 10, step: 1 } },
        'start, step and restart belong to a ramp; set mode to "ramp"'
      ],
      [
        { dataType: 'uint16', generator: { min: 0, max: 10, restart: false } },
        'start, step and restart belong to a ramp; set mode to "ramp"'
      ]
    ] as const)('rejects %j', (fields, reason) => {
      expect(reasons(resolve(fields))).toEqual([reason])
    })

    // `start + step` is 65536, which a uint16 cannot hold, and was checked as
    // a value to write. The ramp writes 65535 and holds on its first tick.
    it('accepts a uint16 ramp whose start sits on the bound its step walks toward', () => {
      const report = resolve({
        dataType: 'uint16',
        generator: { mode: 'ramp', start: 65535, step: 1, min: 0, max: 65535, restart: false }
      })
      expect(reasons(report)).toEqual([undefined])
      expect(report.points[0]?.resolved?.generator).toMatchObject({ start: 65535, step: 1 })
    })

    it.each([
      ['uint16', { scalingFactor: 2 }, 0.1, 2],
      ['uint16', { scalingFactor: 2 }, 3, 2],
      ['int16', { scalingFactor: -2 }, 3, 2],
      ['uint16', { interpolate: { x1: 0, x2: 10, y1: 0, y2: 100 } }, 5, 10]
    ] as const)(
      'names the resolution a %s under %j gives when a step of %d is not a whole raw step',
      (dataType, scaling, step, resolution) => {
        const report = resolve({
          dataType,
          ...scaling,
          generator: { mode: 'ramp', start: 20, step, min: 0, max: 100 }
        })
        expect(reasons(report)).toEqual([
          `Ramp step: ${step} is smaller than, or not a multiple of, the resolution of ${resolution} this scaling gives a ${dataType}`
        ])
      }
    )

    it('names the resolution when a step rounds to 0 raw beside a large start', () => {
      const report = resolve({
        dataType: 'uint32',
        scalingFactor: 10,
        generator: { mode: 'ramp', start: 4e9, step: 1, min: 0, max: 4e10 }
      })
      expect(reasons(report)).toEqual([
        'Ramp step: 1 is smaller than, or not a multiple of, the resolution of 10 this scaling gives a uint32'
      ])
    })

    // `80 + -0.1 - 80` is -0.09999999999999432, which the schema refuses for
    // its decimals, so a raw step taken as a difference fails these.
    it.each([
      ['float', {}, { start: 80, step: -0.1, min: 20, max: 80 }, -0.1],
      ['double', {}, { start: 80, step: -0.1, min: 20, max: 80 }, -0.1],
      ['float', {}, { start: 0.1, step: 0.2, min: 0, max: 1 }, 0.2],
      ['double', {}, { start: 0.1, step: 0.2, min: 0, max: 1 }, 0.2],
      ['float', { scalingFactor: 0.1 }, { start: 0, step: 0.3, min: 0, max: 1 }, 3],
      ['double', { scalingFactor: 0.1 }, { start: 0, step: 0.3, min: 0, max: 1 }, 3],
      ['float', { scalingFactor: 0.1 }, { start: 80, step: -0.1, min: 20, max: 80 }, -1],
      ['double', { scalingFactor: -0.1 }, { start: 0.1, step: 0.2, min: 0, max: 1 }, -2],
      [
        'double',
        { interpolate: { x1: 0, x2: 10, y1: 0.1, y2: 0.4 } },
        { start: 0.1, step: 0.03, min: 0.1, max: 0.4 },
        1
      ]
    ] as const)(
      'accepts a %s ramp under %j with %j, stepping %d raw',
      (dataType, scaling, generator, rawStep) => {
        const report = resolve({ dataType, ...scaling, generator: { mode: 'ramp', ...generator } })
        expect(reasons(report)).toEqual([undefined])
        expect(report.points[0]?.resolved?.generator?.step).toBe(rawStep)
      }
    )

    // 20 / 0.3 is 66.66666666666667, past the 7 decimals the schema holds a
    // float ramp to. 10 / 0.3 rounds up and 40 / 0.3 down, so 0.3 times
    // either is inside 10 to 40.
    it.each(['float', 'double'] as const)(
      'rounds the raw start of a scaled %s ramp to the decimals the schema takes, and its bounds inward',
      (dataType) => {
        const report = resolve({
          dataType,
          scalingFactor: 0.3,
          generator: { mode: 'ramp', start: 20, step: 0.3, min: 10, max: 40 }
        })
        expect(reasons(report)).toEqual([undefined])
        expect(report.points[0]?.resolved?.generator).toMatchObject({
          start: 66.6666667,
          step: 1,
          min: 33.3333334,
          max: 133.3333333
        })
      }
    )

    it('refuses an unscaled float ramp step with more decimals than the schema takes', () => {
      const report = resolve({
        dataType: 'float',
        generator: { mode: 'ramp', start: 0, step: 0.123456789, min: 0, max: 1 }
      })
      expect(reasons(report)[0]).toMatch(/at most 7 decimals/)
    })

    it('rejects a step finer than the scaling resolution with the step reason', () => {
      const report = resolve({
        scalingFactor: 10,
        generator: { mode: 'ramp', start: 0, step: 1, min: 0, max: 1000 }
      })
      expect(reasons(report)[0]).toMatch(/^Ramp step: /)
    })

    // A step measured as `unscale(start + step)` is measured beside 1e9.
    it('names the resolution of a uint32 step of 1.25 beside a start of 1e9', () => {
      const report = resolve({
        dataType: 'uint32',
        generator: { mode: 'ramp', start: 1e9, step: 1.25, min: 1e9, max: 1e9 + 10 }
      })
      expect(reasons(report)).toEqual([
        'Ramp step: 1.25 is smaller than, or not a multiple of, the resolution of 1 this scaling gives a uint32'
      ])
    })

    // 1e-9 of the value, which `isWhole` takes, is 1 at 1e9.
    it('names the resolution of an unscaled uint32 step of 1000000000.25', () => {
      const report = resolve({
        dataType: 'uint32',
        generator: { mode: 'ramp', start: 0, step: 1000000000.25, min: 0, max: 2e9 }
      })
      expect(reasons(report)).toEqual([
        'Ramp step: 1000000000.25 is smaller than, or not a multiple of, the resolution of 1 this scaling gives a uint32'
      ])
    })

    it.each([
      [{ start: 1000000000.25, min: 0, max: 1e9 }, 'Ramp start', 1000000000.25],
      [{ start: 1e9, min: 0.25, max: 2e9 }, 'Generator min', 0.25],
      [{ start: 0, min: 0, max: 1000000000.25 }, 'Generator max', 1000000000.25]
    ])('refuses an unscaled uint32 ramp with %j as a fraction', (bounds, label, value) => {
      const report = resolve({
        dataType: 'uint32',
        generator: { mode: 'ramp', step: 1, ...bounds }
      })
      expect(reasons(report)).toEqual([
        `${label}: Engineering value ${value} is raw ${value}, and a uint32 holds whole numbers`
      ])
    })

    // 0.3 / 0.1 is 2.9999999999999996.
    it('accepts a uint32 ramp whose scaled start and step miss a whole raw value by rounding', () => {
      const report = resolve({
        dataType: 'uint32',
        scalingFactor: 0.1,
        generator: { mode: 'ramp', start: 0.3, step: 0.3, min: 0.3, max: 1000 }
      })
      expect(reasons(report)).toEqual([undefined])
      expect(report.points[0]?.resolved?.generator).toMatchObject({ start: 3, step: 3, min: 3 })
    })

    // `unscale(1e16 + 1)` is `unscale(1e16)`, because doubles there are 2
    // apart, so the step was taken for 0 raw.
    it('accepts a uint16 step of 1 under an interpolation whose engineering values sit at 1e16', () => {
      const report = resolve({
        dataType: 'uint16',
        interpolate: { x1: 0, x2: 10, y1: 1e16, y2: 1e16 + 10 },
        generator: { mode: 'ramp', start: 1e16, step: 1, min: 1e16, max: 1e16 + 10 }
      })
      expect(reasons(report)).toEqual([undefined])
      expect(report.points[0]?.resolved?.generator).toMatchObject({ start: 0, step: 1, max: 10 })
    })

    it('names the resolution of a uint16 step of 1e-10', () => {
      const report = resolve({
        dataType: 'uint16',
        generator: { mode: 'ramp', start: 0, step: 1e-10, min: 0, max: 10 }
      })
      expect(reasons(report)).toEqual([
        'Ramp step: 1e-10 is smaller than, or not a multiple of, the resolution of 1 this scaling gives a uint16'
      ])
    })

    // Raw start 0.10000001 and raw max 0.1 both round to 0.1 at 7 decimals.
    it('rejects a scaled double start past max before rounding takes it back inside', () => {
      const report = resolve({
        dataType: 'double',
        scalingFactor: 10,
        generator: { mode: 'ramp', start: 1.0000001, step: -1, min: 0, max: 1 }
      })
      expect(reasons(report)).toEqual(['The ramp start has to be between its min and max'])
    })

    it('accepts a scaled double start on max, rounded with it', () => {
      const report = resolve({
        dataType: 'double',
        scalingFactor: 0.3,
        generator: { mode: 'ramp', start: 40, step: -0.3, min: 10, max: 40 }
      })
      expect(reasons(report)).toEqual([undefined])
      expect(report.points[0]?.resolved?.generator).toMatchObject({
        start: 133.3333333,
        max: 133.3333333
      })
    })

    // Raw max 1.6e-7 rounded to the nearest 7 decimals is 2e-7, which writes
    // an engineering 4e-7 on the second step.
    it.each([
      [
        { start: 0, min: 0, max: 3.2e-7 },
        { start: 0, min: 0, max: 1e-7 }
      ],
      [
        { start: 0, min: -3.2e-7, max: 0 },
        { start: 0, min: -1e-7, max: 0 }
      ],
      [
        { start: 0.6, min: 0.6, max: 4.2 },
        { start: 0.3, min: 0.3, max: 2.1 }
      ]
    ])('keeps a scaled double ramp with %j inside its bounds as %j raw', (bounds, raw) => {
      const report = resolve({
        dataType: 'double',
        scalingFactor: 2,
        generator: { mode: 'ramp', step: 2e-7, restart: false, ...bounds }
      })
      expect(reasons(report)).toEqual([undefined])
      expect(report.points[0]?.resolved?.generator).toMatchObject({ ...raw, step: 1e-7 })
    })

    // Raw 1.49e-7 rounds to 1e-7, so the first value written was 1 where 1.49
    // was asked for. Raw 1.6e-7 on max is rounded inward with max to 1e-7.
    it.each([
      [1e7, { start: 1.49, step: 1, min: 0, max: 10 }, 1],
      [2, { start: 3.2e-7, step: 2e-7, min: 0, max: 3.2e-7 }, 2e-7]
    ])(
      'names the resolution of a scaled double start that 7 raw decimals move, under %d with %j',
      (scalingFactor, generator, resolution) => {
        const report = resolve({
          dataType: 'double',
          scalingFactor,
          generator: { mode: 'ramp', restart: false, ...generator }
        })
        expect(reasons(report)).toEqual([
          `Ramp start: ${generator.start} is not a multiple of the resolution of ${resolution} this scaling gives a double`
        ])
      }
    )

    // 8.7 / 10 is 0.8699999999999999 and 0.3 / 0.1 is 2.9999999999999996, a
    // float error of the division that raw 0.87 and raw 3 read back across.
    it.each([
      [
        'double',
        10,
        { start: 0, step: 2.9, min: 0, max: 8.7 },
        { start: 0, step: 0.29, min: 0, max: 0.87 }
      ],
      [
        'double',
        0.1,
        { start: 0, step: 0.1, min: 0, max: 0.3 },
        { start: 0, step: 1, min: 0, max: 3 }
      ],
      [
        'float',
        0.1,
        { start: 0, step: 0.1, min: 0, max: 0.3 },
        { start: 0, step: 1, min: 0, max: 3 }
      ],
      [
        'double',
        -0.1,
        { start: 0, step: 0.1, min: 0, max: 0.3 },
        { start: 0, step: -1, min: -3, max: 0 }
      ],
      [
        'float',
        -0.1,
        { start: 0, step: 0.1, min: 0, max: 0.3 },
        { start: 0, step: -1, min: -3, max: 0 }
      ],
      [
        'double',
        0.1,
        { start: 0.3, step: 0.1, min: 0.3, max: 0.3 },
        { start: 3, step: 1, min: 3, max: 3 }
      ],
      [
        'double',
        100,
        { start: 0.0011, step: 0.001, min: 0.0011, max: 0.01 },
        { start: 0.000011, step: 0.00001, min: 0.000011, max: 0.0001 }
      ]
    ] as const)(
      'keeps the bounds of a %s ramp under a factor of %d with %j where their raw value reads back as them',
      (dataType, scalingFactor, generator, raw) => {
        const report = resolve({
          dataType,
          scalingFactor,
          generator: { mode: 'ramp', restart: false, ...generator }
        })
        expect(reasons(report)).toEqual([undefined])
        expect(report.points[0]?.resolved?.generator).toMatchObject(raw)
      }
    )

    it('keeps the bounds of a float ramp under a factor of 0.001 and an offset of 1.5', () => {
      const report = resolve({
        dataType: 'float',
        scalingFactor: 0.001,
        interpolate: { x1: 0, x2: 1, y1: 1.5, y2: 2.5 },
        generator: { mode: 'ramp', start: 0, step: 0.3, min: 0, max: 1.2, restart: false }
      })
      expect(reasons(report)).toEqual([undefined])
      expect(report.points[0]?.resolved?.generator).toMatchObject({
        start: -1500,
        step: 300,
        min: -1500,
        max: -300
      })
    })

    // Raw step 0.1666667 three times is 0.5000001, past a raw max of 0.5 rounded
    // alone, so the ramp held one step short of 0.3. Falling by raw
    // 9.6666667 from 29, tick 3 is -0.0000001, below a raw min of 0.
    it.each([
      ['float', 0.6, { start: 0, step: 0.1, min: 0, max: 0.3 }, [0, 0.1, 0.2, 0.3]],
      ['double', 0.6, { start: 0, step: 0.1, min: 0, max: 0.3 }, [0, 0.1, 0.2, 0.3]],
      ['double', 0.3, { start: 8.7, step: -2.9, min: 0, max: 8.7 }, [8.7, 5.8, 2.9, 0]]
    ] as const)(
      'writes every step a %s ramp under a factor of %d with %j asks for',
      (dataType, scalingFactor, generator, asked) => {
        const report = resolve({
          dataType,
          scalingFactor,
          generator: { mode: 'ramp', restart: false, ...generator }
        })
        expect(reasons(report)).toEqual([undefined])
        const resolved = report.points[0]?.resolved?.generator
        if (resolved?.start === undefined || resolved.step === undefined) {
          throw new Error('the ramp was not resolved')
        }
        const spec = { ...resolved, start: resolved.start, step: resolved.step, restart: false }
        const engineering = [resolved.start * scalingFactor]
        for (let stepCount = 0; ; ) {
          const tick = nextRampTick(spec, stepCount)
          if (tick.kind === 'hold') break
          engineering.push(tick.value * scalingFactor)
          stepCount = tick.stepCount
        }
        expect(engineering.map((value) => Number(value.toFixed(6)) + 0)).toEqual(asked)
      }
    )

    // Raw step 0.0333333 lags 0.01 / 0.3 by about 1e-8 in engineering units,
    // a tenth of a step after about 100000 steps.
    it('refuses a scaled double counter longer than a tenth of a step of drift, naming both counts', () => {
      const report = resolve({
        dataType: 'double',
        scalingFactor: 0.3,
        generator: { mode: 'ramp', start: 0, step: 0.01, min: 0, max: 10000 }
      })
      expect(reasons(report)).toEqual([
        `Ramp step: 0.01 is not a multiple of the resolution of ${0.3 / 10 ** 7} this scaling gives a double, which keeps a ramp within a tenth of a step for 99999 steps, and this one asks for 1000000`
      ])
    })

    // Raw step 0.3333333 lags 0.1 / 0.3, so raw tick 4 is 1.3333332, inside a
    // raw max of 1.3333333, and writes 0.39999996 after the 0.3 asked for last.
    it('refuses a scaled double ramp whose raw ticks take a step more than asked for', () => {
      const report = resolve({
        dataType: 'double',
        scalingFactor: 0.3,
        generator: { mode: 'ramp', start: 0, step: 0.1, min: 0, max: 0.39999999, restart: false }
      })
      expect(reasons(report)).toEqual([
        `Ramp step: 0.1 reaches 0.39999999 in 3 steps, and at the resolution of ${0.3 / 10 ** 7} this scaling gives a double the raw ramp takes another`
      ])
    })

    // Raw start 0.100000049 rounds to 0.1, which is engineering 0: about half
    // a step from the 0.000049 asked for.
    it.each(['float', 'double'] as const)(
      'names the resolution of a %s start that 7 raw decimals move by half a step under an offset',
      (dataType) => {
        const report = resolve({
          dataType,
          scalingFactor: 1000,
          interpolate: { x1: 0, x2: 1, y1: -100, y2: -99 },
          generator: { mode: 'ramp', start: 0.000049, step: 0.0001, min: 0, max: 1, restart: false }
        })
        expect(reasons(report)).toEqual([
          `Ramp start: 0.000049 is not a multiple of the resolution of 0.0001 this scaling gives a ${dataType}`
        ])
      }
    )

    it('refuses a scaled double ramp whose bounds hold no raw value at 7 decimals', () => {
      const report = resolve({
        dataType: 'double',
        scalingFactor: 2,
        generator: { mode: 'ramp', start: 1.2e-7, step: 2e-7, min: 1.2e-7, max: 1.6e-7 }
      })
      expect(reasons(report)).toEqual([
        'Ramp min 1.2e-7 and max 1.6e-7 hold no raw value at 7 decimals under this scaling'
      ])
    })

    // Raw 1e-8 rounds to 0 at 7 decimals, and the reason read as if the step
    // given were 0.
    it('names the resolution of a float step that rounds to 0 raw under a scaling', () => {
      const report = resolve({
        dataType: 'float',
        scalingFactor: 10,
        generator: { mode: 'ramp', start: 0, step: 1e-7, min: 0, max: 1 }
      })
      expect(reasons(report)).toEqual([
        'Ramp step: 1e-7 is smaller than the resolution of 0.000001 this scaling gives a float'
      ])
    })

    // Raw 1.49e-7 rounds to 1e-7 at 7 decimals, so the register stepped by 1
    // engineering unit where 1.49 was asked for.
    it.each(['float', 'double'] as const)(
      'names the resolution of a scaled %s step that 7 raw decimals cannot hold',
      (dataType) => {
        const report = resolve({
          dataType,
          scalingFactor: 1e7,
          generator: { mode: 'ramp', start: 0, step: 1.49, min: 0, max: 4.47, restart: false }
        })
        expect(reasons(report)).toEqual([
          `Ramp step: 1.49 is not a multiple of the resolution of 1 this scaling gives a ${dataType}, which keeps a ramp within a tenth of a step for 0 steps, and this one asks for 3`
        ])
      }
    )

    // 0.1 / 0.3 is 0.33333333333333337, which 7 decimals move by about 1e-7
    // of itself.
    it('accepts a scaled double step whose raw value 7 decimals round by a part in 1e7', () => {
      const report = resolve({
        dataType: 'double',
        scalingFactor: 0.3,
        generator: { mode: 'ramp', start: 0, step: 0.1, min: 0, max: 3 }
      })
      expect(reasons(report)).toEqual([undefined])
      expect(report.points[0]?.resolved?.generator?.step).toBe(0.3333333)
    })

    it('answers a scaled float step of 0 with the step being 0', () => {
      const report = resolve({
        dataType: 'float',
        scalingFactor: 10,
        generator: { mode: 'ramp', start: 0, step: 0, min: 0, max: 1 }
      })
      expect(reasons(report)).toEqual(['The ramp step is 0 after scaling'])
    })
  })

  it.each([
    [
      { dataType: 'uint16', value: 70000 },
      'Raw value 70000: A uint16 value has to be between 0 and 65535'
    ],
    [
      { dataType: 'uint16', value: 1, generator: { min: 0, max: 1 } },
      'A point takes a fixed value or a generator, not both'
    ],
    [{ dataType: 'uint16', generator: { min: 0 } }, 'A generator needs a min and a max'],
    [
      { dataType: 'uint16', generator: { min: -1, max: 1 } },
      'Generator min: Raw value -1: A uint16 value has to be between 0 and 65535'
    ],
    [
      { dataType: 'uint16', generator: { min: 0, max: 70000 } },
      'Generator max: Raw value 70000: A uint16 value has to be between 0 and 65535'
    ],
    [{ dataType: 'uint16', value: true }, 'A uint16 value is a number'],
    [{ dataType: 'utf8', length: 2, value: 'abcde' }, '"abcde" is 5 bytes, and 2 registers hold 4'],
    [{ dataType: 'utf8', value: 3 }, 'A utf8 value is a string'],
    [{ dataType: 'utf8', generator: { min: 0, max: 1 } }, 'A utf8 point has no generator']
  ] as const)('rejects %j', (fields, reason) => {
    const report = validatePointTable([serverPoint({ address: 0, ...fields })], {
      target: 'server'
    })
    expect(reasons(report)).toEqual([reason])
  })

  it.each([
    [{ value: 1 }, 'A coils value is true or false'],
    [{ generator: { min: 0, max: 1 } }, 'A coils point has no generator']
  ] as const)('rejects a coil with %j', (fields, reason) => {
    const report = validatePointTable(
      [{ name: 'Run', address: 0, registerType: 'coils', ...fields }],
      { target: 'server' }
    )
    expect(reasons(report)).toEqual([reason])
  })

  it('stores a utf8 string as its raw value', () => {
    const report = validatePointTable(
      [serverPoint({ address: 0, dataType: 'utf8', length: 3, value: 'Modbux' })],
      { target: 'server' }
    )
    expect(report.points[0]?.resolved).toMatchObject({ raw: 'Modbux', width: 3 })
  })

  it('ignores a value on a client table, which the client schema does not carry', () => {
    const parsed = PointSchema.parse({ name: 'V', address: 0, registerType: 'coils', value: 3 })
    expect(parsed).not.toHaveProperty('value')
  })
})

describe('what an accepted table becomes', () => {
  const report = validatePointTable(
    [
      {
        name: 'Voltage',
        address: 40011,
        dataType: 'float',
        scalingFactor: 0.1,
        unit: 'V',
        value: 230.5,
        byteOrder: 'CDAB'
      },
      { name: 'Energy', address: 40001, dataType: 'int32', value: -123456, generator: undefined },
      {
        name: 'Level',
        address: 40021,
        dataType: 'uint16',
        interpolate: { x1: 4, x2: 20, y1: 0, y2: 100 },
        generator: { min: 0, max: 100 }
      },
      { name: 'Serial', address: 30001, dataType: 'utf8', length: 4, value: 'AB12' },
      { name: 'Run', address: '00005', value: true },
      { name: 'Bad', address: 40001, dataType: 'int16' }
    ] satisfies ServerPoint[],
    { target: 'server', notation: 'modicon', unitId: 2 }
  )
  const points = acceptedPoints(report)

  it('keeps the accepted points in table order', () => {
    expect(points.map((entry) => entry.comment)).toEqual([
      'Voltage [V]',
      'Energy',
      'Level',
      'Serial',
      'Run'
    ])
  })

  it('maps each accepted point under its register type and PDU address', () => {
    const mapping = clientMappingOf(points)
    expect(mapping.holding_registers).toEqual({
      0: { comment: 'Energy', dataType: 'int32' },
      10: { comment: 'Voltage [V]', dataType: 'float', scalingFactor: 0.1 },
      20: {
        comment: 'Level',
        dataType: 'uint16',
        interpolate: { x1: '4', x2: '20', y1: '0', y2: '100' }
      }
    })
    expect(mapping.input_registers).toEqual({
      0: { comment: 'Serial', dataType: 'utf8', length: 4 }
    })
    expect(mapping.coils).toEqual({ 4: { comment: 'Run' } })
    expect(mapping.discrete_inputs).toEqual({})
  })

  it("reads the first point's type from its lowest address to its furthest end", () => {
    expect(readWindowOf(points)).toEqual({
      window: { type: 'holding_registers', address: 0, length: 21 },
      otherTypes: ['input_registers', 'coils']
    })
    expect(readWindowOf([])).toBeUndefined()
  })

  it('builds the params the server stores, and none for a bit', () => {
    expect(points.map(serverRegisterParams)).toEqual([
      {
        address: 10,
        registerType: 'holding_registers',
        dataType: 'float',
        comment: 'Voltage [V]',
        value: 2305
      },
      {
        address: 0,
        registerType: 'holding_registers',
        dataType: 'int32',
        comment: 'Energy',
        value: -123456
      },
      {
        address: 20,
        registerType: 'holding_registers',
        dataType: 'uint16',
        comment: 'Level',
        min: 4,
        max: 20,
        interval: 1000
      },
      {
        address: 0,
        registerType: 'input_registers',
        dataType: 'utf8',
        comment: 'Serial',
        value: 0,
        stringValue: 'AB12',
        length: 4
      },
      undefined
    ])
  })

  it('puts every point under its unit', () => {
    const units = serverUnitsOf(points)
    expect(Object.keys(units)).toEqual(['2'])
    expect(units['2']?.coils).toEqual({ 4: { value: true, comment: 'Run' } })
    expect(Object.keys(units['2']?.holding_registers ?? {})).toEqual(['0', '10', '20'])
    // A fixed register holds its raw value at once, a generated one 0.
    expect(units['2']?.holding_registers[10]).toEqual({
      value: 2305,
      params: expect.objectContaining({ value: 2305 })
    })
    expect(units['2']?.holding_registers[20]?.value).toBe(0)
    expect(units['2']?.input_registers[0]?.value).toBe(0)
    expect(units['2']?.discrete_inputs).toEqual({})
  })
})

it('holds a 64 bit integer as the decimal string the store keeps', () => {
  const report = validatePointTable(
    [
      {
        name: 'Energy',
        address: 0,
        registerType: 'holding_registers',
        dataType: 'int64',
        value: -5
      }
    ],
    { target: 'server' }
  )
  expect(serverUnitsOf(acceptedPoints(report))['0']?.holding_registers[0]?.value).toBe('-5')
})

// The fold keeps a datetime as the four ABCD words packed into 64 bits, so
// the seed is that composite and not the milliseconds the table gave.
it('holds a fixed datetime as the packed composite the store keeps', () => {
  const ms = Date.UTC(2024, 0, 1, 12, 30, 0)
  const report = validatePointTable(
    [
      {
        name: 'Clock',
        address: 0,
        registerType: 'holding_registers',
        dataType: 'datetime',
        value: ms
      }
    ],
    { target: 'server' }
  )
  expect(serverUnitsOf(acceptedPoints(report))['0']?.holding_registers[0]?.value).toBe(
    '6756503450943488'
  )
})

// The scalable types the forward conversion reads, so a type added there and
// not here is a test that names it.
it('round trips every scalable type through scaleValue', () => {
  const types: DataType[] = [
    'int16',
    'uint16',
    'int32',
    'uint32',
    'int64',
    'uint64',
    'float',
    'double'
  ]
  for (const dataType of types) {
    const conversion = engineeringToRaw(12.5, dataType, { scalingFactor: 0.5 })
    expect(conversion).toEqual({ ok: true, raw: 25 })
    expect(scaleValue('25', dataType, { scalingFactor: 0.5 })).toBe(12.5)
  }
})
