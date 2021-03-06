/// <reference path="../../node_modules/@types/mocha/index.d.ts" />
/// <reference path="../../node_modules/@types/chai/index.d.ts" />

import {expect} from 'chai';
import {IDocumentStore} from "../../src/Documents/IDocumentStore";
import {IDocumentSession} from "../../src/Documents/Session/IDocumentSession";
import {IRavenObject} from "../../src/Typedef/IRavenObject";
import {DocumentType, IStoredRawEntityInfo, DocumentConstructor} from "../../src/Documents/Conventions/DocumentConventions";
import {Foo, TestConversion, TestCustomIdProperty, TestCustomSerializer} from "../TestClasses";
import {RequestExecutor} from "../../src/Http/Request/RequestExecutor";
import {ISerialized, IAttributeSerializer} from "../../src/Json/Serializer";
import { StringUtil } from '../../src/Utility/StringUtil';

describe('Document conversion test', () => {
  const now: Date = new Date();
  let store: IDocumentStore;
  let session: IDocumentSession;
  let defaultDatabase: string, defaultUrl: string;

  const nestedObjectTypes: IRavenObject<DocumentConstructor> = {
    foo: Foo,
    foos: Foo
  };

  const serializer: IAttributeSerializer = {
    onSerialized: (serialized: ISerialized): void => {
      if (TestCustomSerializer.name !== serialized.metadata['Raven-Node-Type']) {
        return;
      }

      serialized.serializedAttribute = StringUtil.uncapitalize(serialized.originalAttribute);

      if ('Items' === serialized.originalAttribute) {
        serialized.serializedValue = (<number[]>serialized.originalValue).join(",");
      }  
    },
    onUnserialized: (serialized: ISerialized): void => {
      if (TestCustomSerializer.name !== serialized.metadata['Raven-Node-Type']) {
        return;
      }

      serialized.serializedAttribute = StringUtil.capitalize(serialized.originalAttribute);

      if ('items' === serialized.originalAttribute) {
        serialized.serializedValue = (<string>serialized.originalValue)
          .split(",").map((item: string): number => parseInt(item));
      }  
    }
  };

  const resolveIdProperty = (typeName: string): string => {
    if ([TestCustomSerializer, TestCustomIdProperty]
      .map((ctor) => ctor.name).includes(typeName)
    ) {
      return 'Id';
    }
  };

  const resolveConstructor = (typeName: string): DocumentConstructor => {
    const classesMap: IRavenObject<DocumentConstructor> =
      <IRavenObject<DocumentConstructor>>require('../TestClasses');

    let foundCtor: DocumentConstructor;  

    if ((typeName in classesMap) && ('function' === 
      (typeof (foundCtor = classesMap[typeName])))
    ) {
      return foundCtor;
    } 
  };
          
  const makeDocument = (id: string = null, date: Date = now): TestConversion => new TestConversion(
    id, date,
    new Foo('Foos/1', 'Foo #1', 1), [
      new Foo('Foos/2', 'Foo #2', 2),
      new Foo('Foos/3', 'Foo #3', 3)
    ]
  );

  const checkFoo = (foo: Foo, idOfFoo: number = 1): void => {
    expect(foo).to.be.a('object');
    expect(foo).to.be.a.instanceOf(Foo);
    expect(foo.id).to.equal(`Foos/${idOfFoo}`);
    expect(foo.name).to.equal(`Foo #${idOfFoo}`);
    expect(foo.order).to.equal(idOfFoo);
  };

  const checkDoc = (id: string, doc: TestConversion): void => {
    expect(doc).to.be.a('object');
    expect(doc).to.be.a.instanceOf(TestConversion);
    expect(doc).to.have.property('id', id);
    expect(typeof doc.date).to.equal('object');
    expect(doc.date).to.be.a.instanceOf(Date);
    checkFoo(doc.foo);

    expect(doc.foos).to.be.an('array');
    doc.foos.forEach((item: Foo, index: number) => checkFoo(item, index + 2));
  };

  beforeEach(function (): void {
    ({defaultDatabase, defaultUrl, store} = (this.currentTest as IRavenObject));
  });

  beforeEach(async () => {
    session = store.openSession();

    await session.store<TestConversion>(makeDocument('TestConversions/1')); 
    await session.store<TestConversion>(makeDocument('TestConversions/2', new Date(now.getTime() + 1000 * 60 * 60 * 24))); 
    await session.store({
      name: "G",
      dateOfBirth: new Date("1987-10-12")
    }, "Person/1");
    await session.saveChanges();   
  });

  describe('Conversion', () => {

    it('should convert on load for stored literal with automatic date conversion', async () => {
        session = store.openSession();
        const doc = await session.load("Person/1");
        expect(doc).to.exist;
        expect(doc.dateOfBirth).to.be.instanceOf(Date);
        expect(doc.dateOfBirth.getFullYear()).to.equal(1987);
        expect(doc.dateOfBirth.getMonth()).to.equal(9);
        expect(doc.dateOfBirth.getDate()).to.equal(12);
        expect(doc.name).to.equal('G');
    });

    it('should convert on load', async () => {
      let doc: TestConversion;
      const key: string = 'TestConversions/1';

      session = store.openSession();
      doc = await session.load<TestConversion>(key, {
        documentType: TestConversion, nestedObjectTypes
      });
      
      checkDoc(key, doc);
    });

    it('should resolve document constructors', async () => {
      let docs: TestConversion[] = [];
      
      session = store.openSession();
      store.conventions.addDocumentInfoResolver({ resolveConstructor });

      await session.load<TestConversion>('TestConversions/1')
        .then((result: TestConversion) => docs.push(result));

      await session.query<TestConversion>({
        collection: 'TestConversions'
      })
      .waitForNonStaleResults()
      .all()
      .then((result: TestConversion[]) => 
        docs = docs.concat(result)
      );

      expect(docs).to.have.lengthOf(3);
      
      [1, 1, 2].forEach((id: number, index: number) =>
        checkDoc(`TestConversions/${id}`, docs[index])
      );
    });

    it('should convert on store then on re-load', async () => {
      let doc: TestConversion;
      const key: string = 'TestingConversions/New';

      session = store.openSession();

      await session.store<TestConversion>(makeDocument(key));  
      await session.saveChanges();

      session = store.openSession();
      doc = await session.load<TestConversion>(key, {
        documentType: TestConversion, nestedObjectTypes
      });

      checkDoc(key, doc);
    });

    it('should convert on query', async () => {
      let doc: TestConversion;
      let docs: TestConversion[];
      session = store.openSession();

      docs = await session.query<TestConversion>({
        collection: 'TestConversions',
        documentType: TestConversion,
        nestedObjectTypes: nestedObjectTypes
      })
      .waitForNonStaleResults()
      .whereGreaterThan<Date>('date', now)
      .all();
      
      expect(docs).to.have.lengthOf(1);
      
      [doc] = docs;            
      checkDoc('TestConversions/2', doc);      
    });

    it('should resolve custom id property name', async () => {
      const key: string = 'TestingCustomIdProperties/New';
      const title: string = 'Testing custom id property';
      let doc: TestCustomIdProperty = new TestCustomIdProperty(key, title);

      session = store.openSession();
      store.conventions.addDocumentInfoResolver({ resolveIdProperty, resolveConstructor });

      await session.store<TestCustomIdProperty>(doc);  
      await session.saveChanges();

      session = store.openSession();
      doc = await session.load<TestCustomIdProperty>(key);

      expect(doc).to.be.an('object');
      expect(doc).to.be.a.instanceOf(TestCustomIdProperty);
      expect(doc).to.have.property('Id', key);
      expect(doc).to.have.property('Title', title);
    });

    it('should support custom serializer', async () => {
      let id: string, info: IStoredRawEntityInfo;
      const title: string = 'Testing custom serializer';
      const items: number[] = [1, 2, 3];
      let doc: TestCustomSerializer = new TestCustomSerializer(null, title, items);

      session = store.openSession();
      store.conventions.addAttributeSerializer(serializer);
      store.conventions.addDocumentInfoResolver({ resolveIdProperty, resolveConstructor });

      await session.store<TestCustomSerializer>(doc);  
      await session.saveChanges();
      id = doc.Id;

      session = store.openSession();
      doc = await session.load<TestCustomSerializer>(id);

      expect(doc).to.be.an('object');
      expect(doc).to.be.a.instanceOf(TestCustomSerializer);
      expect(doc).to.have.property('Id', id);
      expect(doc).to.have.property('Title', title);
      expect(doc).to.have.property('Items')
      expect(doc.Items).to.deep.equal(items);

      info = (<Map<IRavenObject, IStoredRawEntityInfo>>session['rawEntitiesAndMetadata']).get(doc);

      expect(info.originalValue).to.an('object');
      expect(info.originalValue).to.have.property('title', title);
      expect(info.originalValue).to.have.property('items', items.join(','));
    });
  });
});

