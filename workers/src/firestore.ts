type FsValue =
  | { nullValue: null }
  | { stringValue: string }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } };

type FsDoc = { fields?: Record<string, FsValue>; name?: string; createTime?: string; updateTime?: string };

function toValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') {
    const fields: Record<string, FsValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== undefined) fields[k] = toValue(val);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function fromValue(v: FsValue): unknown {
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = fromValue(val);
    return out;
  }
  return null;
}

function docToObject(doc: FsDoc): Record<string, unknown> | null {
  if (!doc?.fields) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields)) out[k] = fromValue(v);
  return out;
}

function objectToFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toValue(v);
  }
  return fields;
}

export class Firestore {
  private base: string;
  private path: string;
  private token: string;

  constructor(projectId: string, token: string) {
    this.path = `projects/${projectId}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.path}`;
    this.token = token;
  }

  private docName(collection: string, docId: string): string {
    return `${this.path}/${collection}/${docId}`;
  }

  private headers() {
    return { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  async get(collection: string, docId: string): Promise<Record<string, unknown> | null> {
    const res = await fetch(`${this.base}/${collection}/${docId}`, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firestore GET failed: ${res.status} ${await res.text()}`);
    const doc = await res.json() as FsDoc;
    return docToObject(doc);
  }

  async set(collection: string, docId: string, data: Record<string, unknown>, merge = false): Promise<void> {
    const fields = objectToFields(data);
    const url = merge
      ? `${this.base}/${collection}/${docId}?${Object.keys(fields).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')}&currentDocument.exists=false`
      : `${this.base}/${collection}/${docId}`;

    const res = await fetch(url, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`Firestore SET failed: ${res.status} ${await res.text()}`);
  }

  async update(collection: string, docId: string, data: Record<string, unknown>): Promise<void> {
    const fields = objectToFields(data);
    const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const res = await fetch(`${this.base}/${collection}/${docId}?${mask}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`Firestore UPDATE failed: ${res.status} ${await res.text()}`);
  }

  async upsert(collection: string, docId: string, data: Record<string, unknown>): Promise<void> {
    const fields = objectToFields(data);
    const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const res = await fetch(`${this.base}/${collection}/${docId}?${mask}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`Firestore UPSERT failed: ${res.status} ${await res.text()}`);
  }

  async add(collection: string, data: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${this.base}/${collection}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ fields: objectToFields(data) }),
    });
    if (!res.ok) throw new Error(`Firestore ADD failed: ${res.status} ${await res.text()}`);
    const doc = await res.json() as FsDoc;
    return doc.name?.split('/').pop() || '';
  }

  async delete(collection: string, docId: string): Promise<void> {
    const res = await fetch(`${this.base}/${collection}/${docId}`, {
      method: 'DELETE', headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Firestore DELETE failed: ${res.status} ${await res.text()}`);
  }

  async query(collection: string, filters: Array<{ field: string; op: string; value: unknown }>): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    const where = filters.length === 1
      ? {
          fieldFilter: {
            field: { fieldPath: filters[0].field },
            op: filters[0].op,
            value: toValue(filters[0].value),
          },
        }
      : {
          compositeFilter: {
            op: 'AND',
            filters: filters.map((f) => ({
              fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: toValue(f.value) },
            })),
          },
        };

    const res = await fetch(`${this.base}:runQuery`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where } }),
    });
    if (!res.ok) throw new Error(`Firestore QUERY failed: ${res.status} ${await res.text()}`);

    const rows = await res.json() as Array<{ document?: FsDoc }>;
    return rows
      .filter((r) => r.document?.name)
      .map((r) => ({
        id: r.document!.name!.split('/').pop()!,
        data: docToObject(r.document!) || {},
      }));
  }

  async setWithServerTimestamp(collection: string, docId: string, data: Record<string, unknown>, tsFields: string[]): Promise<void> {
    const fields = objectToFields(data);
    const transforms = tsFields.map((f) => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' }));

    const write: Record<string, unknown> = {
      update: { name: this.docName(collection, docId), fields },
      updateTransforms: transforms,
    };

    const res = await fetch(`${this.base}:commit`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ writes: [write] }),
    });
    if (!res.ok) throw new Error(`Firestore setWithServerTimestamp failed: ${res.status} ${await res.text()}`);
  }

  async upsertWithTransforms(
    collection: string,
    docId: string,
    data: Record<string, unknown>,
    transforms: Array<{ field: string; type: 'serverTimestamp' | 'increment' | 'arrayUnion' | 'delete'; value?: unknown }>,
  ): Promise<void> {
    const fields = objectToFields(data);
    const fieldTransforms = transforms
      .filter((t) => t.type !== 'delete')
      .map((t) => {
        if (t.type === 'serverTimestamp') return { fieldPath: t.field, setToServerValue: 'REQUEST_TIME' };
        if (t.type === 'increment') return { fieldPath: t.field, increment: toValue(t.value as number) };
        if (t.type === 'arrayUnion') return { fieldPath: t.field, appendMissingElements: { values: [toValue(t.value)] } };
        return null;
      })
      .filter(Boolean);

    const deleteFields = transforms.filter((t) => t.type === 'delete').map((t) => t.field);
    const allDataKeys = [...Object.keys(fields), ...deleteFields];
    const mask = allDataKeys.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');

    const write: Record<string, unknown> = {
      update: { name: this.docName(collection, docId), fields },
      updateMask: { fieldPaths: allDataKeys },
      ...(fieldTransforms.length > 0 ? { updateTransforms: fieldTransforms } : {}),
    };

    const res = await fetch(`${this.base}:commit`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ writes: [write] }),
    });
    if (!res.ok) throw new Error(`Firestore upsertWithTransforms failed: ${res.status} ${await res.text()} mask=${mask}`);
  }

  async runTransaction<T>(fn: (tx: FirestoreTransaction) => Promise<T>): Promise<T> {
    const commitBase = this.base;

    const beginRes = await fetch(`${commitBase}:beginTransaction`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    if (!beginRes.ok) throw new Error(`beginTransaction failed: ${beginRes.status} ${await beginRes.text()}`);
    const { transaction } = await beginRes.json() as { transaction: string };

    const tx = new FirestoreTransaction(this.base, this.token, transaction);

    let result: T;
    try {
      result = await fn(tx);
    } catch (err) {
      await fetch(`${commitBase}:rollback`, {
        method: 'POST', headers: this.headers(),
        body: JSON.stringify({ transaction }),
      });
      throw err;
    }

    const commitRes = await fetch(`${commitBase}:commit`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ transaction, writes: tx.writes }),
    });
    if (!commitRes.ok) throw new Error(`Transaction commit failed: ${commitRes.status} ${await commitRes.text()}`);

    return result;
  }
}

export class FirestoreTransaction {
  writes: unknown[] = [];
  private reads = new Map<string, Record<string, unknown> | null>();
  private path: string;

  constructor(private base: string, private token: string, private transaction: string) {
    this.path = base.replace('https://firestore.googleapis.com/v1/', '');
  }

  private dn(collection: string, docId: string) { return `${this.path}/${collection}/${docId}`; }

  private headers() {
    return { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  async get(collection: string, docId: string): Promise<Record<string, unknown> | null> {
    const key = `${collection}/${docId}`;
    if (this.reads.has(key)) return this.reads.get(key)!;

    const res = await fetch(`${this.base}/${collection}/${docId}?transaction=${encodeURIComponent(this.transaction)}`, {
      headers: this.headers(),
    });
    if (res.status === 404) { this.reads.set(key, null); return null; }
    if (!res.ok) throw new Error(`Transaction GET failed: ${res.status} ${await res.text()}`);
    const doc = await res.json() as FsDoc;
    const data = docToObject(doc);
    this.reads.set(key, data);
    return data;
  }

  set(collection: string, docId: string, data: Record<string, unknown>): void {
    this.writes.push({
      update: { name: this.dn(collection, docId), fields: objectToFields(data) },
    });
  }

  update(collection: string, docId: string, data: Record<string, unknown>): void {
    const fields = objectToFields(data);
    this.writes.push({
      update: { name: this.dn(collection, docId), fields },
      updateMask: { fieldPaths: Object.keys(fields) },
    });
  }

  upsert(collection: string, docId: string, data: Record<string, unknown>): void {
    const fields = objectToFields(data);
    this.writes.push({
      update: { name: this.dn(collection, docId), fields },
      updateMask: { fieldPaths: Object.keys(fields) },
    });
  }

  setWithTransforms(collection: string, docId: string, data: Record<string, unknown>, transforms: Array<{ field: string; type: 'serverTimestamp' | 'increment' | 'arrayUnion'; value?: unknown }>): void {
    const fields = objectToFields(data);
    const fieldTransforms = transforms.map((t) => {
      if (t.type === 'serverTimestamp') return { fieldPath: t.field, setToServerValue: 'REQUEST_TIME' };
      if (t.type === 'increment') return { fieldPath: t.field, increment: toValue(t.value as number) };
      if (t.type === 'arrayUnion') return { fieldPath: t.field, appendMissingElements: { values: [toValue(t.value)] } };
      return null;
    }).filter(Boolean);

    this.writes.push({
      update: { name: this.dn(collection, docId), fields },
      ...(fieldTransforms.length > 0 ? { updateTransforms: fieldTransforms } : {}),
    });
  }

  addDoc(collection: string, data: Record<string, unknown>): string {
    const id = crypto.randomUUID().replace(/-/g, '');
    this.writes.push({
      update: { name: this.dn(collection, id), fields: objectToFields(data) },
    });
    return id;
  }
}
