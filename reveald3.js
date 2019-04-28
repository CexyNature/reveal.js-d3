/**
 * reveal.js plugin to integrate d3.js visualizations into slides and trigger transitions supporting data-fragment-index
 */
var Reveald3 = window.Reveald3 || (function(){
    // check if configurations need to be overwritten
    const config = Reveal.getConfig() || {};
    config.reveald3 = config.reveald3 || {};

    const options = {
          // If the previous slide is a slide further in the deck (i.e. we come back to
          // slide from the next slide), by default the last fragment transition will be
          // triggered to to get the last state of the visualization. This can be
          // discarded.
          runLastState: config.reveald3.runLastState == undefined ? !config.reveald3.runLastState : config.reveald3.runLastState, //default true

          // This will prefix the path attributes of the source html paths with the given path.
          // (by default "src" if set to true or with the specified path if string)
          mapPath: typeof(config.reveald3.mapPath) == 'string' ? config.reveald3.mapPath : ( config.reveald3.mapPath ? 'src' : '' ),

          // If true, will try to locate the file at a fallback url without the mapPath prefix in case no file is found
          // at the stipulated url with mapPath
          tryFallbackURL: config.reveald3.tryFallbackURL == undefined ? !!config.reveald3.tryFallbackURL : config.reveald3.tryFallbackURL, //default false

          // Checking for file existance has been reported to fail in rare 
          // cases though files did exist. This option is to disable the file checking.
          //see: https://github.com/gcalmettes/reveal.js-d3/issues/10
          disableCheckFile: config.reveald3.disableCheckFile == undefined ? !!config.reveald3.disableCheckFile : config.reveald3.disableCheckFile,
        };

    // propagate keydown when focus is on iframe (child)
    // https://stackoverflow.com/a/41361761/2503795
    window.document.addEventListener('iframe-keydown',
        (event) => Reveal.triggerKey(event.detail.keyCode), false);


    /////////////////////////////////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////
    //
    //              Functions for SLIDE EVENTS
    //
    /////////////////////////////////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////

    // Both "ready" and "slidechanged" Revealjs eventListeners are added to load
    // the D3 visualizations on the slides. The "ready" event is there only for the
    // specific case where there is a D3 visualization on first slide
    Reveal.addEventListener('ready', function( event ) {
        initializeAllVisualizations()
    });

    Reveal.addEventListener('slidechanged', function( event ) {
        // need to run last visualization state?
        const { currentSlide, previousSlide } = event
        if (options.runLastState && isNavigationBack({ currentSlide, previousSlide })){
          let allIframes = getAllIframes(currentSlide)
          for (const iframe of allIframes) {
            triggerLastState(iframe)
          }  
        }
    });


    function initializeAllVisualizations(){
      const allVizSlides = getAllVizSlides()

      const currentSlide = Reveal.getCurrentSlide()
        
      // loop over each slide containing at least one viz container
      for ( const vizSlide of Object.values(allVizSlides) ) {
        // loop over each viz object in the slide
        for ( const viz of vizSlide.containers ) {
          const styles = getIframeStyle(viz)
          // add iframe to slide
          initialize({
            isBackground: viz.isBackground,
            onCurrentSlide: vizSlide.slide == currentSlide,
            index: vizSlide.index,
            slide: vizSlide.slide,
            container: viz.container,
            file: viz.file,
            preload: viz.preload,
            fragmentsInSlide: vizSlide.fragmentsInSlide,
            iframeStyle: styles.iframeStyle,
            iframeExtra: styles.iframeExtra
          })          
        }
      }    
    }


    function getAllVizSlides() {
      const allVizSlides = Array.from(document.getElementsByClassName('fig-container'))
        .reduce((acc, cur) => {
          const isSection = cur.tagName == 'SECTION'
          const isBackground = !isSection
            ? false
            : cur.hasAttribute("data-no-background")
              ? false
              : true
          const slide = isSection ? cur : cur.closest('section')
          if (slide) {
            // create name based on indices of the slide
            const { h, v, f } = Reveal.getIndices(slide)
            const name = `h-${h || null}/v-${v || null}/f-${f || null}`
            acc[name] = acc[name]
              ? Object.assign(acc[name], {
                containers: [...acc[name].containers, {
                    isBackground: isSection,
                    container: cur,
                    file: cur.getAttribute('data-file'),
                    preload: cur.hasAttribute('data-preload')
                  }]})
              : ({ 
                  index: { h, v },
                  slide,
                  containers: [{
                    isBackground: isBackground,
                    container: cur,
                    file: cur.getAttribute('data-file'),
                    preload: cur.hasAttribute('data-preload')
                  }],
                  fragmentsInSlide: getUniqueFragmentIndices(slide)
                })
          }
          return acc
        }, {})
      return allVizSlides
    }

    function getUniqueFragmentIndices(slide){
      let slideFragments = Array.prototype.slice.call(slide.querySelectorAll( '.fragment' ))
      // filter out fragments created for transition steps, if any
      slideFragments = slideFragments.filter(d => !d.getAttribute("class").split().includes("visualizationStep"))
      let fragmentIndices = []
      for (let i=0; i<slideFragments.length; i++){
          fragmentIndices.push(parseInt(slideFragments[i].getAttribute( 'data-fragment-index' )))
      }
      fragmentIndices = [...new Set(fragmentIndices)];
      return fragmentIndices
    }


    const getIframeStyle = viz => {
      const defaultStyle = {
          'margin': '0px',
          'width': '100vw',
          'height': '100vh',
          'max-width': '100%',
          'max-height': '100%',
          'z-index': 1,
          'border': 0
        }

      const dataStyleString = viz.container.getAttribute('data-style') ? viz.container.getAttribute('data-style') : "";
      const regexStyle = /\s*([^;^\s]*)\s*:\s*([^;^\s]*(\s*)?(!important)?)/g

      let inputtedStyle = {}, matchStyleArray;
      while (matchStyleArray = regexStyle.exec(dataStyleString)) {
        inputtedStyle[matchStyleArray[1]] = matchStyleArray[2]
      }
      const iframeStyle = Object.assign(defaultStyle, inputtedStyle)

      // special attribute(s) for iframe. So far there is only data-scroll.
      const iframeExtra = {
        scrolling: viz.container.getAttribute('data-scroll') 
          ? viz.container.getAttribute('data-scroll') 
          : "yes"
      }
      return { iframeStyle, iframeExtra }
    }

    async function initialize(vizObject) {
        const { isBackground, onCurrentSlide, index, slide, container, file, fragmentsInSlide, preload,
                iframeStyle, iframeExtra } = vizObject

        // by default hid overflow of container so combining iframe margins and height/width
        // can be used to define an area without seeing the overflow.
        // This can be overridden using the data-overflow-shown=true attribute
        container.style.overflow = (container.style.overflow=="" && !JSON.parse(container.getAttribute('data-overflow-shown'))) ? 'hidden' : container.style.overflow

        const fileExists = !options.disableCheckFile ? await doesFileExist( options.mapPath + file ) : true
        const filePath = (options.tryFallbackURL && fileExists) ? options.mapPath + file : file

        // continue only if iframe hasn't been created already for this container
        const iframeList = container.querySelectorAll('iframe')
        if (iframeList.length>0) return;

        // generate styles string
        const styles = Object.entries(iframeStyle)
          .reduce((res, [key, value]) => `${res}${key}:${String(value).replace(/\s+/, " ")};`, "")

        // create iframe to embed html file
        let iframeConfig = {
            'class': 'iframe-visualization',
            'sandbox': 'allow-popups allow-scripts allow-forms allow-same-origin',
            'style': styles,
            ...iframeExtra
        }
        // handle case of viz in current slide and ensure compatibility
        // with Reveal.js lazy loading capability of iframes
        const src = onCurrentSlide 
          ? {'src': filePath, 'data-lazy-loaded': '' } 
          : {'data-src': filePath}
        // need to preload iframe if in the viewDistance window?
        const preloading = preload 
          ? { 'data-preload': true } 
          : {}
        const backgroundIframe = isBackground
          ? { 
              'allowfullscreen': '',
              'mozallowfullscreen': '',
              'webkitallowfullscreen': '',
              'width': '100%',
              'height': '100%'
            }
          : {}

        iframeConfig = Object.assign(
          iframeConfig, 
          { ...src, 
            ...preloading, 
            ...backgroundIframe
          }
        )
       
        const iframe = document.createElement('iframe')
        for (const [key, value] of Object.entries(iframeConfig)){
            iframe.setAttribute(key, value)
        }

        // if an iframe background, put it on the corresponding background slide
        if (isBackground) {
          const backgroundSlide = Reveal.getSlideBackground(slide)
          const slideBackgroundContent = backgroundSlide.querySelector(".slide-background-content")
          slideBackgroundContent.appendChild(iframe)
        } else {
          container.appendChild(iframe)
        }

        //event to be triggered once iframe load is complete
        iframe.addEventListener("load", function () {
            if (isBackground) {
              // make the overflow of the current slide visible to be sure that
              // all its content will show up
              slide.style.overflow = "visible"
            }

            const fig = (iframe.contentWindow || iframe.contentDocument);

            // add custom event listener to propatage key presses to parent
            // https://stackoverflow.com/a/41361761/2503795
            fig.addEventListener('keydown', function(e) {
                const customEvent = new CustomEvent('iframe-keydown', { detail: e });
                window.parent.document.dispatchEvent(customEvent)
            });

            ///////////////////////////////////////////////////////////////////////////
            // If more than one visualization on the slide, intelligently create/update
            // the data-fragment indices for each steps of each visualization, taking
            // in account all the data-fragment-indices stipulated for each viz
            //////////////////////////////////////////////////////////////////////////

            // get all the visualization steps from all the visualizations on the slide
            let nodeList = getAllIframes(slide)
            let allVisualizationSteps = []
            for (const node of nodeList){
                const fig = (node.contentWindow || node.contentDocument);
                if (fig._transitions) allVisualizationSteps.push(fig._transitions)
            }

            // get the corresponding data-fragment-index in the slide fragment context
            // and see if new spans have to be created to trigger visualization steps
            const [allVizStepsDict, spansToCreate] = generateVisualizationStepsIndices(allVisualizationSteps, fragmentsInSlide)

            // store the visualization steps to be triggered in a variable attached to each iframe
            for (let i=0; i<nodeList.length ; i++){
              nodeList[i].transitionSteps = allVizStepsDict[i];
            }

            // add spans fragments to trigger visualization steps
            const currentSlide = Reveal.getCurrentSlide()
            const previousSlide = Reveal.getPreviousSlide()
            const isNavBack = isNavigationBack({ currentSlide, previousSlide })
            let fragmentSpans = slide.querySelectorAll('.fragment.visualizationStep')
            if (fragmentSpans.length < spansToCreate.length){
                const nSpansToCreate = spansToCreate.length - fragmentSpans.length
                for (let i=0; i<nSpansToCreate; i++){
                    const spanFragment = document.createElement('span')
                    if (isNavBack) {
                      // ensure the fragments will be ran even if first time loaded
                      // and navigating from a latter slide,
                      spanFragment.setAttribute('class', 'fragment visualizationStep visible')
                    } else {
                      spanFragment.setAttribute('class', 'fragment visualizationStep')
                    }
                    slide.appendChild(spanFragment)
                }
            }
            fragmentSpans = slide.querySelectorAll('.fragment.visualizationStep')
            for (let i=0; i<spansToCreate.length; i++){
                fragmentSpans[i].setAttribute('data-fragment-index', spansToCreate[i])
            }
            // need to run some extra?
            if (options.runLastState && (slide == currentSlide)){
              // trigger only if all iframe have gotten their correct transition list
              if (iframe == nodeList[nodeList.length-1]) {
                  for (const node of nodeList) {
                    triggerLastState(node)
                  }
              }
            }
            // patch from AffeAli.
            // see https://github.com/gcalmettes/reveal.js-d3/issues/5#issuecomment-443797557
            Reveal.layout()
        }); //onload

        if (isBackground) {
            //event to be triggered once iframe load is complete
            iframe.addEventListener("beforeunload", function () {
                // revert back the style change
                // NOTE: doesn't seem to be triggered ....
                slide.style.overflow = "hidden"
            })
        }
    }

    function getAllIframes(slide){
      // get all iframe in foreground and background of slide
      // and convert NodeList to array
      const backgroundSlide = Reveal.getSlideBackground(slide)
      const iframeSlide = Array.prototype.slice.call(slide.querySelectorAll('iframe'))
      const iframeBackground = Array.prototype.slice.call(backgroundSlide.querySelectorAll('iframe'))

      // filter out non "iframe-visualization" iframes
      let allIframes = [].concat(...[iframeSlide, iframeBackground])
      allIframes = allIframes.filter(d => d.className.includes("iframe-visualization"))
      return allIframes
    }

    function doesFileExist(fileUrl) {
        return fetch(fileUrl, {
            method: "head",
            mode: "no-cors"
          }).then(response => {
            if (response.ok && response.status == 200) {
                // console.log("file exists!");
                return true
            } else {
              console.log(`Couldn't locate "${fileUrl}", fallback to original url at "${fileUrl.slice(options.mapPath.length)}" if mapPath was set.`)
                return false
            }
          })
          .catch(function(error) {
            console.log("Error ", error);
          });
    }

    function generateVisualizationStepsIndices(allVisualizationSteps, slideFragmentSteps){
        // add data-fragment-index to missing steps for each viz
        let allVisualizationIndices = []
        for (let i=0; i<allVisualizationSteps.length; i++){
            const visualizationSteps = allVisualizationSteps[i]

            let visualizationIndices

            if(visualizationSteps){
                const nVisualizationSteps = visualizationSteps.length

                visualizationIndices = visualizationSteps.filter(d => d.index>=0).map(d => d.index)
                if (visualizationIndices.length < nVisualizationSteps) {
                    const nIndicesToAdd = nVisualizationSteps - visualizationIndices.length
                    const startIndex = visualizationIndices.length == 0 ? 0 : Math.max.apply(null, visualizationIndices)+1
                    for (let j=0; j<nIndicesToAdd; j++){
                        visualizationIndices.push(j+startIndex)
                    }
                }
                allVisualizationIndices.push(visualizationIndices)
            }
        }

        // some spread operator kungfu techniques to get unique values of data-fragment-index in viz
        let uniqueAllVisualizationIndices = [...new Set([].concat(...allVisualizationIndices))]
        uniqueAllVisualizationIndices.sort((a, b) => a - b)

        // Generate data-fragment-index list of spans to be added to slide
        const nSlideFragmentSteps = slideFragmentSteps.length

        const extraIndex = uniqueAllVisualizationIndices.map(d => d>nSlideFragmentSteps-1)
        const extraSteps = extraIndex.reduce((a, b) => a+b, 0);

        let fragmentIndexToCreate
        if (extraSteps==0){
            fragmentIndexToCreate = []
        } else {
            // range [nSlideFragmentSteps, nSlideFragmentSteps+extraSteps]
            fragmentIndexToCreate = [...Array(extraSteps).keys()].map(d => d+nSlideFragmentSteps)
        }

        // hash table for correspondance (data-fragment-index <=> slide fragments sequence)
        let hashTable = {}
        let count = 0
        uniqueAllVisualizationIndices.forEach(d => {
            if (d>nSlideFragmentSteps-1){
                hashTable[d] = fragmentIndexToCreate[count]
                count+=1
            } else {
                hashTable[d] = d
            }
        })

        // convert visualization indices to the right slide data-fragment-index
        let allVisualizationStepsIndices = []
        for (let i=0; i<allVisualizationSteps.length; i++){
            const visualizationSteps = allVisualizationSteps[i]
            const visualizationIndices = allVisualizationIndices[i]

            if ((visualizationSteps) && (visualizationIndices)){
                const nVisualizationSteps = visualizationSteps.length

                let visualizationStepsIndices = {}

                for (let j=0; j<nVisualizationSteps; j++) {
                    visualizationStepsIndices[hashTable[visualizationIndices[j]]] = {
                        transitionForward: visualizationSteps[j].transitionForward,
                        transitionBackward: (visualizationSteps[j].transitionBackward == "none") ? () => {} : (visualizationSteps[j].transitionBackward) ? visualizationSteps[j].transitionBackward : visualizationSteps[(j-1 >= 0 ? j-1 : 0)].transitionForward
                    }
                }

                allVisualizationStepsIndices.push(visualizationStepsIndices)
            }
        }
        return [allVisualizationStepsIndices, uniqueAllVisualizationIndices.map(d => hashTable[d])]
    }

    function triggerLastState(iframe){
        // If the previous slide is a slide further in the deck (i.e. we come back to
        // slide from the next slide), trigger the last fragment transition to get the
        // the last state
        const currentSlide = Reveal.getCurrentSlide()
        const previousSlide = Reveal.getPreviousSlide()
        if (isNavigationBack({ currentSlide, previousSlide })) {
            const allFragments = currentSlide.querySelectorAll('.fragment.visualizationStep')
            if (allFragments.length==0) return
            let allFragmentsIndices = []
            for (let i=0; i< allFragments.length; i++){
                allFragmentsIndices.push(parseInt(allFragments[i].getAttribute('data-fragment-index')))
            }
            triggerTransition(iframe, Math.max.apply(null, allFragmentsIndices), 'forward')
        }
    }

    function isNavigationBack(slides) {
        const { currentSlide, previousSlide } = slides
        const idxCurrent = Reveal.getIndices(currentSlide)
        const idxPrevious = Reveal.getIndices(previousSlide)
        return (idxCurrent.h<idxPrevious.h) || (idxCurrent.v<idxPrevious.v)
    }


    /////////////////////////////////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////
    //
    //              Functions for FRAGMENTS EVENTS
    //
    /////////////////////////////////////////////////////////////////////
    /////////////////////////////////////////////////////////////////////

    // Fragmentshown and fragmenthidden Revealjs events to trigger
    // the transitions (and inverse transitions) in the D3 visualization
    Reveal.addEventListener('fragmentshown', function(event) {
        //proceed only if this is a visualizationStep fragment
        if (!proceed(event)) return;
        handleFragments(event, 'forward')
    });

    Reveal.addEventListener('fragmenthidden', function(event) {
        //proceed only if this is a visualizationStep fragment
        if (!proceed(event)) return;
        handleFragments(event, 'backward')
    });


    function proceed(event) {
        // only proceed if one of the fragments of the step has `fig-transition` class
        let allClassNames = ""
        for (let i=0; i<event.fragments.length; i++){
            allClassNames = allClassNames.concat(event.fragments[i].className)
        }
        return allClassNames.includes('visualizationStep')
    }

    function triggerAllTransitions(allIframes, currentStep, direction){
        for (let i=0; i<allIframes.length; i++){
            triggerTransition(allIframes[i], currentStep, direction)
        }
    }

    function triggerTransition(iframe, currentStep, direction){
        if (direction=="forward") {
            if ((iframe.transitionSteps) && (iframe.transitionSteps[currentStep])) {
               (iframe.transitionSteps[currentStep].transitionForward || Function)()
            }
        } else {
            if ((iframe.transitionSteps) && (iframe.transitionSteps[currentStep])) {
               (iframe.transitionSteps[currentStep].transitionBackward || Function)()
            }
        }
    }

    function handleFragments(event, direction){
        //get data-fragment-index of current step
        let currentStep = parseInt(event.fragments[0].getAttribute('data-fragment-index'))
        // forward transition
        const slide = event.fragment.closest('section')
        // get all iframe embedding visualisations
        let allIframes = getAllIframes(slide)
        triggerAllTransitions(allIframes, currentStep, direction)
    }

})(); // Reveald3
