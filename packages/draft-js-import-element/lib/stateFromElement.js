'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

exports.stateFromElement = stateFromElement;

var _replaceTextWithMeta3 = require('./lib/replaceTextWithMeta');

var _replaceTextWithMeta4 = _interopRequireDefault(_replaceTextWithMeta3);

var _draftJs = require('draft-js');

var _immutable = require('immutable');

var _draftJsUtils = require('draft-js-utils');

var _syntheticDom = require('synthetic-dom');

var _Constants = require('./lib/Constants');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// A ParsedBlock has two purposes:
//   1) to keep data about the block (textFragments, type)
//   2) to act as some context for storing parser state as we parse its contents
var DATA_URL = /^data:/i;
var NO_STYLE = (0, _immutable.OrderedSet)();
var NO_ENTITY = null;

var EMPTY_BLOCK = new _draftJs.ContentBlock({
  key: (0, _draftJs.genKey)(),
  text: '',
  type: _draftJsUtils.BLOCK_TYPE.UNSTYLED,
  characterList: (0, _immutable.List)(),
  depth: 0
});

var LINE_BREAKS = /(\r\n|\r|\n)/g;
// We use `\r` because that character is always stripped from source (normalized
// to `\n`), so it's safe to assume it will only appear in the text content when
// we put it there as a placeholder.
var SOFT_BREAK_PLACEHOLDER = '\r';
var ZERO_WIDTH_SPACE = '\u200B';
var DATA_ATTRIBUTE = /^data-([a-z0-9-]+)$/;

// Map element attributes to entity data.
var ELEM_ATTR_MAP = {
  a: { href: 'url', rel: 'rel', target: 'target', title: 'title' },
  img: { src: 'src', alt: 'alt' }
};

var getEntityData = function getEntityData(tagName, element) {
  var data = {};
  if (ELEM_ATTR_MAP.hasOwnProperty(tagName)) {
    var attrMap = ELEM_ATTR_MAP[tagName];
    for (var i = 0; i < element.attributes.length; i++) {
      var _element$attributes$i = element.attributes[i],
          name = _element$attributes$i.name,
          value = _element$attributes$i.value;

      if (typeof value === 'string') {
        var strVal = value;
        if (attrMap.hasOwnProperty(name)) {
          var newName = attrMap[name];
          data[newName] = strVal;
        } else if (DATA_ATTRIBUTE.test(name)) {
          data[name] = strVal;
        }
      }
    }
  }
  return data;
};

// Functions to create entities from elements.
var ElementToEntity = {
  a: function a(generator, tagName, element) {
    var data = getEntityData(tagName, element);
    // Don't add `<a>` elements with invalid href.
    if (isAllowedHref(data.url)) {
      return generator.createEntity(_draftJsUtils.ENTITY_TYPE.LINK, data);
    }
  },
  img: function img(generator, tagName, element) {
    var data = getEntityData(tagName, element);
    // Don't add `<img>` elements with no src.
    if (data.src != null) {
      return generator.createEntity(_draftJsUtils.ENTITY_TYPE.IMAGE, data);
    }
  }
};

var ContentGenerator = function () {
  function ContentGenerator() {
    var _this = this;

    var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    _classCallCheck(this, ContentGenerator);

    this.inlineCreators = {
      Style: function Style(style) {
        return { type: 'STYLE', style: style };
      },
      Entity: function Entity(type, data) {
        var mutability = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'MUTABLE';
        return {
          type: 'ENTITY',
          entityKey: _this.createEntity(type, toStringMap(data), mutability)
        };
      }
    };

    this.options = options;
    this.contentStateForEntities = _draftJs.ContentState.createFromBlockArray([]);
    // This represents the hierarchy as we traverse nested elements; for
    // example [body, ul, li] where we must know li's parent type (ul or ol).
    this.blockStack = [];
    // This is a linear list of blocks that will form the output; for example
    // [p, li, li, blockquote].
    this.blockList = [];
    this.depth = 0;
  }
  // This will be passed to the customInlineFn to allow it
  // to return a Style() or Entity().


  _createClass(ContentGenerator, [{
    key: 'process',
    value: function process(element) {
      this.processBlockElement(element);
      var contentBlocks = [];
      this.blockList.forEach(function (block) {
        var _concatFragments = concatFragments(block.textFragments),
            text = _concatFragments.text,
            characterMeta = _concatFragments.characterMeta;

        var includeEmptyBlock = false;
        // If the block contains only a soft break then don't discard the block,
        // but discard the soft break.
        if (text === SOFT_BREAK_PLACEHOLDER) {
          includeEmptyBlock = true;
          text = '';
        }
        if (block.tagName === 'pre') {
          var _trimLeadingNewline = trimLeadingNewline(text, characterMeta);

          text = _trimLeadingNewline.text;
          characterMeta = _trimLeadingNewline.characterMeta;
        } else if (block.type !== 'atomic') {
          var _collapseWhiteSpace = collapseWhiteSpace(text, characterMeta);

          text = _collapseWhiteSpace.text;
          characterMeta = _collapseWhiteSpace.characterMeta;
        }
        // Previously we were using a placeholder for soft breaks. Now that we
        // have collapsed whitespace we can change it back to normal line breaks.
        text = text.split(SOFT_BREAK_PLACEHOLDER).join('\n');
        // Discard empty blocks (unless otherwise specified).
        if (text.length || includeEmptyBlock) {
          contentBlocks.push(new _draftJs.ContentBlock({
            key: (0, _draftJs.genKey)(),
            text: text,
            type: block.type,
            characterList: characterMeta.toList(),
            depth: block.depth,
            data: block.data ? (0, _immutable.Map)(block.data) : (0, _immutable.Map)()
          }));
        }
      });
      if (!contentBlocks.length) {
        contentBlocks = [EMPTY_BLOCK];
      }
      return _draftJs.ContentState.createFromBlockArray(contentBlocks, this.contentStateForEntities.getEntityMap());
    }
  }, {
    key: 'getBlockTypeFromTagName',
    value: function getBlockTypeFromTagName(tagName) {
      var blockTypes = this.options.blockTypes;

      if (blockTypes && blockTypes[tagName]) {
        return blockTypes[tagName];
      }
      switch (tagName) {
        case 'li':
          {
            var parent = this.blockStack.slice(-1)[0];
            return parent.tagName === 'ol' ? _draftJsUtils.BLOCK_TYPE.ORDERED_LIST_ITEM : _draftJsUtils.BLOCK_TYPE.UNORDERED_LIST_ITEM;
          }
        case 'blockquote':
          {
            return _draftJsUtils.BLOCK_TYPE.BLOCKQUOTE;
          }
        case 'h1':
          {
            return _draftJsUtils.BLOCK_TYPE.HEADER_ONE;
          }
        case 'h2':
          {
            return _draftJsUtils.BLOCK_TYPE.HEADER_TWO;
          }
        case 'h3':
          {
            return _draftJsUtils.BLOCK_TYPE.HEADER_THREE;
          }
        case 'h4':
          {
            return _draftJsUtils.BLOCK_TYPE.HEADER_FOUR;
          }
        case 'h5':
          {
            return _draftJsUtils.BLOCK_TYPE.HEADER_FIVE;
          }
        case 'h6':
          {
            return _draftJsUtils.BLOCK_TYPE.HEADER_SIX;
          }
        case 'pre':
          {
            return _draftJsUtils.BLOCK_TYPE.CODE;
          }
        case 'figure':
          {
            return _draftJsUtils.BLOCK_TYPE.ATOMIC;
          }
        default:
          {
            return _draftJsUtils.BLOCK_TYPE.UNSTYLED;
          }
      }
    }
  }, {
    key: 'processBlockElement',
    value: function processBlockElement(element) {
      if (!element) {
        return;
      }
      var customBlockFn = this.options.customBlockFn;

      var tagName = element.nodeName.toLowerCase();
      var type = void 0;
      var data = void 0;

      var inlineAttachmentBlock = this.__getPossibleThreadsInlineAttachment(element);
      if (inlineAttachmentBlock) {
        this.blockList.push(inlineAttachmentBlock);
        return;
      }
      if (element.tagName === 'DIV' && element.getAttribute('data-threads-ignore') === 'true') {
        return;
      }

      // Set the depth for this node and all child nodes
      if (element.tagName === 'LI' && element.className.indexOf('public-DraftStyleDefault-depth1') >= 0) {
        this.depth = 1;
      }

      if (customBlockFn) {
        var customBlock = customBlockFn(element);
        if (customBlock != null) {
          type = customBlock.type;
          data = customBlock.data;
        }
      }
      var isCustomType = true;
      if (type == null) {
        isCustomType = false;
        type = this.getBlockTypeFromTagName(tagName);
      }
      var allowRender = !_Constants.SPECIAL_ELEMENTS.hasOwnProperty(tagName);
      if (!isCustomType && !hasSemanticMeaning(type)) {
        var parent = this.blockStack.slice(-1)[0];
        if (parent) {
          type = parent.type;
        }
      }
      var block = {
        tagName: tagName,
        textFragments: [],
        type: type,
        styleStack: [NO_STYLE],
        entityStack: [NO_ENTITY],
        depth: this.depth,
        data: data
      };
      if (allowRender) {
        this.blockList.push(block);
      }
      this.blockStack.push(block);
      if (element.childNodes != null) {
        Array.from(element.childNodes).forEach(this.processNode, this);
      }
      this.blockStack.pop();
      if (allowRender) {
        // Reset depth after rendering all child nodes,
        // so eg a block after a <li> with depth=1 will have depth=0
        this.depth = 0;
      }
    }
  }, {
    key: 'processInlineElement',
    value: function processInlineElement(element) {
      var tagName = element.nodeName.toLowerCase();
      if (tagName === 'br') {
        this.processText(SOFT_BREAK_PLACEHOLDER);
        return;
      }
      var block = this.blockStack.slice(-1)[0];
      var style = block.styleStack.slice(-1)[0];
      var entityKey = block.entityStack.slice(-1)[0];
      var customInlineFn = this.options.customInlineFn;

      var customInline = customInlineFn ? customInlineFn(element, this.inlineCreators) : null;
      if (customInline != null) {
        switch (customInline.type) {
          case 'STYLE':
            {
              style = style.add(customInline.style);
              break;
            }
          case 'ENTITY':
            {
              entityKey = customInline.entityKey;
              break;
            }
        }
      } else {
        style = addStyleFromTagName(style, tagName, this.options.elementStyles);
        if (ElementToEntity.hasOwnProperty(tagName)) {
          // If the to-entity function returns nothing, use the existing entity.
          entityKey = ElementToEntity[tagName](this, tagName, element) || entityKey;
        }
      }
      block.styleStack.push(style);
      block.entityStack.push(entityKey);
      if (element.childNodes != null) {
        Array.from(element.childNodes).forEach(this.processNode, this);
      }
      if (_Constants.SELF_CLOSING_ELEMENTS.hasOwnProperty(tagName)) {
        this.processText('\xA0');
      }
      block.entityStack.pop();
      block.styleStack.pop();
    }
  }, {
    key: 'processTextNode',
    value: function processTextNode(node) {
      var text = node.nodeValue;
      // This is important because we will use \r as a placeholder for a soft break.
      text = text.replace(LINE_BREAKS, '\n');
      // Replace zero-width space (we use it as a placeholder in markdown) with a
      // soft break.
      // TODO: The import-markdown package should correctly turn breaks into <br>
      // elements so we don't need to include this hack.
      text = text.split(ZERO_WIDTH_SPACE).join(SOFT_BREAK_PLACEHOLDER);
      this.processText(text);
    }
  }, {
    key: 'processText',
    value: function processText(text) {
      var block = this.blockStack.slice(-1)[0];
      var style = block.styleStack.slice(-1)[0];
      var entity = block.entityStack.slice(-1)[0];
      var charMetadata = _draftJs.CharacterMetadata.create({
        style: style,
        entity: entity
      });
      var seq = (0, _immutable.Repeat)(charMetadata, text.length);
      block.textFragments.push({
        text: text,
        characterMeta: seq
      });
    }
  }, {
    key: 'processNode',
    value: function processNode(node) {
      if (node.nodeType === _syntheticDom.NODE_TYPE_ELEMENT) {
        // $FlowIssue
        var _element = node;
        var _tagName = _element.nodeName.toLowerCase();
        if ((this.blockStack.slice(-1)[0] && this.blockStack.slice(-1)[0].type) === 'table-cell') {
          this.processInlineElement(_element);
        } else if (_Constants.INLINE_ELEMENTS.hasOwnProperty(_tagName)) {
          this.processInlineElement(_element);
        } else {
          this.processBlockElement(_element);
        }
      } else if (node.nodeType === _syntheticDom.NODE_TYPE_TEXT) {
        this.processTextNode(node);
      }
    }
  }, {
    key: 'createEntity',
    value: function createEntity(type, data) {
      var mutability = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'MUTABLE';

      this.contentStateForEntities = this.contentStateForEntities.createEntity(type, mutability, data);
      return this.contentStateForEntities.getLastCreatedEntityKey();
    }
  }, {
    key: '__getPossibleThreadsInlineAttachment',
    value: function __getPossibleThreadsInlineAttachment(element) {
      if (element.tagName === 'DIV' && element.getAttribute('data-threads-type') === 'attachment') {
        var _data = {};
        try {
          _data = JSON.parse(element.getAttribute('data-threads-data'));
        } catch (ex) {
          // do nothing
        }
        var _entityKey = this.createEntity('image', toStringMap(_data), 'IMMUTABLE');
        var _text = " ";
        var charMetadata = _draftJs.CharacterMetadata.create({
          style: NO_STYLE,
          entity: _entityKey
        });
        var seq = (0, _immutable.Repeat)(charMetadata, _text.length);

        var block = {
          tagName: element.nodeName.toLowerCase(),
          textFragments: [{
            text: _text,
            characterMeta: seq
          }],
          type: 'atomic',
          styleStack: [NO_STYLE],
          entityStack: [NO_ENTITY],
          depth: 0,
          data: {}
        };
        return block;
      }
    }
  }]);

  return ContentGenerator;
}();

function trimLeadingNewline(text, characterMeta) {
  if (text.charAt(0) === '\n') {
    text = text.slice(1);
    characterMeta = characterMeta.slice(1);
  }
  return { text: text, characterMeta: characterMeta };
}

function trimLeadingSpace(text, characterMeta) {
  while (text.charAt(0) === ' ') {
    text = text.slice(1);
    characterMeta = characterMeta.slice(1);
  }
  return { text: text, characterMeta: characterMeta };
}

function trimTrailingSpace(text, characterMeta) {
  while (text.slice(-1) === ' ') {
    text = text.slice(0, -1);
    characterMeta = characterMeta.slice(0, -1);
  }
  return { text: text, characterMeta: characterMeta };
}

function collapseWhiteSpace(text, characterMeta) {
  text = text.replace(/[ \t\n]/g, ' ');

  var _trimLeadingSpace = trimLeadingSpace(text, characterMeta);

  text = _trimLeadingSpace.text;
  characterMeta = _trimLeadingSpace.characterMeta;

  var _trimTrailingSpace = trimTrailingSpace(text, characterMeta);

  text = _trimTrailingSpace.text;
  characterMeta = _trimTrailingSpace.characterMeta;

  var i = text.length;
  while (i--) {
    if (text.charAt(i) === ' ' && text.charAt(i - 1) === ' ') {
      text = text.slice(0, i) + text.slice(i + 1);
      characterMeta = characterMeta.slice(0, i).concat(characterMeta.slice(i + 1));
    }
  }
  // There could still be one space on either side of a softbreak.

  var _replaceTextWithMeta = (0, _replaceTextWithMeta4.default)({ text: text, characterMeta: characterMeta }, SOFT_BREAK_PLACEHOLDER + ' ', SOFT_BREAK_PLACEHOLDER);

  text = _replaceTextWithMeta.text;
  characterMeta = _replaceTextWithMeta.characterMeta;

  var _replaceTextWithMeta2 = (0, _replaceTextWithMeta4.default)({ text: text, characterMeta: characterMeta }, ' ' + SOFT_BREAK_PLACEHOLDER, SOFT_BREAK_PLACEHOLDER);

  text = _replaceTextWithMeta2.text;
  characterMeta = _replaceTextWithMeta2.characterMeta;

  return { text: text, characterMeta: characterMeta };
}

function canHaveDepth(blockType) {
  switch (blockType) {
    case _draftJsUtils.BLOCK_TYPE.UNORDERED_LIST_ITEM:
    case _draftJsUtils.BLOCK_TYPE.ORDERED_LIST_ITEM:
      {
        return true;
      }
    default:
      {
        return false;
      }
  }
}

function concatFragments(fragments) {
  var text = '';
  var characterMeta = (0, _immutable.Seq)();
  fragments.forEach(function (textFragment) {
    text = text + textFragment.text;
    characterMeta = characterMeta.concat(textFragment.characterMeta);
  });
  return { text: text, characterMeta: characterMeta };
}

function addStyleFromTagName(styleSet, tagName, elementStyles) {
  switch (tagName) {
    case 'b':
    case 'strong':
      {
        return styleSet.add(_draftJsUtils.INLINE_STYLE.BOLD);
      }
    case 'i':
    case 'em':
      {
        return styleSet.add(_draftJsUtils.INLINE_STYLE.ITALIC);
      }
    case 'u':
    case 'ins':
      {
        return styleSet.add(_draftJsUtils.INLINE_STYLE.UNDERLINE);
      }
    case 'code':
      {
        return styleSet.add(_draftJsUtils.INLINE_STYLE.CODE);
      }
    case 's':
    case 'del':
      {
        return styleSet.add(_draftJsUtils.INLINE_STYLE.STRIKETHROUGH);
      }
    default:
      {
        // Allow custom styles to be provided.
        if (elementStyles && elementStyles[tagName]) {
          return styleSet.add(elementStyles[tagName]);
        }

        return styleSet;
      }
  }
}

function hasSemanticMeaning(blockType) {
  return blockType !== _draftJsUtils.BLOCK_TYPE.UNSTYLED;
}

function toStringMap(input) {
  // JON: what the fuck is wrong with you people.
  return input;
  var result = {};
  if (input !== null && (typeof input === 'undefined' ? 'undefined' : _typeof(input)) === 'object' && !Array.isArray(input)) {
    var obj = input;
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (var _iterator = Object.keys(obj)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
        var _key = _step.value;

        var value = obj[_key];
        if (typeof value === 'string') {
          result[_key] = value;
        }
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion && _iterator.return) {
          _iterator.return();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }
  }
  return result;
}

function isAllowedHref(input) {
  if (input == null || input.match(DATA_URL)) {
    return false;
  } else {
    return true;
  }
}

function stateFromElement(element, options) {
  return new ContentGenerator(options).process(element);
}

exports.default = stateFromElement;